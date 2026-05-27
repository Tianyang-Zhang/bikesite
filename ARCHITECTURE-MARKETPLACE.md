# Marketplace architecture — Sell + Parts + payment-ready orders

This document explains how the Sell and Parts tabs work today and exactly
where a payment provider (Stripe Checkout being the obvious one) slots in
tomorrow.

The headline: **the frontend never has to change when you add payments.**
The same INSERT into `orders` that runs today gets a status transition
later, driven by a webhook — not by the buyer's browser.

## Today (no payment integration)

```
Public Sell/Parts tab                 Supabase                  Manager
─────────────────────                  ────────                  ───────
buyer browses listings ───────────►  sale_bikes_public / parts_public  (anon SELECT)
buyer clicks "Reserve / Inquire"
fills name + WeChat
              │
              └─ INSERT into orders ─►  status='pending'                 ─► admin page
                                       payment_provider=NULL                ▼
                                       payment_session_id=NULL          manager reaches
                                       payment_intent_id=NULL           out on WeChat,
                                                                        arranges payment
                                                                        out-of-band, then
                                                                        bumps status to
                                                                        'paid' → 'fulfilled'
```

That's the whole flow. The order row carries everything we need (qty,
unit/total price, buyer contact, item reference) and the manager closes the
loop manually. This is intentionally identical in shape to the rental
booking flow: anonymous INSERT, RLS-guarded, manager has all-access.

## Tomorrow (Stripe Checkout, for example)

When we want real payment, the change is **server-side only**:

```
Public Sell/Parts tab                 Supabase                       Stripe
─────────────────────                  ────────                       ──────
buyer clicks "Reserve / Inquire"
fills name + WeChat
              │
              └─ INSERT into orders ─►  status='pending'
                                                 │
                                                 │  trigger / Edge Function
                                                 ▼
                                       create Checkout Session ─────► stripe.checkout
                                       store session_id,                       │
                                       payment_provider='stripe'               │
                                                                                ▼
                                                                 buyer redirected to
                                                                 Stripe-hosted page,
                                                                 enters card, pays
                                                                                │
                                       receive `checkout.session.completed` ◄───┘
                                       webhook (Edge Function)
                                                 │
                                                 ▼
                                       UPDATE orders
                                         SET status='paid',
                                             payment_intent_id=...
```

### What changes

| Surface | Change |
| --- | --- |
| `docs/sell.js`, `docs/parts.js` | After a successful INSERT, read back `payment_session_url` (a column we add) and `window.location =` to it. Two lines. |
| `docs/index.html` | Nothing structural — the inquire button copy might change from "Reserve / Inquire" to "Reserve & Pay". |
| `supabase/06_marketplace.sql` | Two columns added (`payment_session_url text`, `payment_session_expires_at timestamptz`). Existing columns already cover provider, session_id, intent_id. |
| Supabase Edge Functions | TWO new functions: one trigger-style ("a new pending order appeared, create Stripe Checkout Session, write back the session URL"), one webhook handler ("Stripe says paid, update order status"). |
| Stripe | One Webhook endpoint configured to hit the Supabase Edge Function URL. |

### What does NOT change

- The schema's primary key, foreign-key surrogates, and existing columns.
- Anon RLS: anon still can only INSERT a pending order with null payment_*.
- The admin page: it just starts seeing rows in `paid` and `fulfilled` more often.
- The broadcast events fired by the public modules.
- The shape of the inquire UI.

## Why an "orders" table and not "inquiries"?

We considered two designs:

1. **`inquiries` table now, separate `payments` table later, join on order_id.**
   Simpler today; one painful migration tomorrow when you wire payment.

2. **One `orders` table from day one, payment_* columns nullable.** A bit more
   schema upfront, but the state machine (`pending → paid → fulfilled →
   cancelled`) is the same machine an inquiry runs and the same machine a paid
   purchase runs.

We picked **(2)**. The status enum already contains the future states; the
payment columns just stay null until you flip the switch. **No row needs to
change shape** when you add Stripe — only new rows acquire non-null payment
fields. Old "inquiry" rows stay valid forever.

## What about overselling?

For rentals, Postgres physically prevents double-booking via the
`no_overlap` GiST EXCLUDE constraint. For parts and sale bikes, the
analogous protection is simpler:

- **sale_bikes**: a `sold` boolean. Once set, the inquire button is
  disabled (`<button disabled>Sold</button>`). A second buyer can't even
  submit. There's a small race window where two buyers click at once on an
  unsold bike — both INSERTs succeed, both orders end up pending, and the
  manager arbitrates. For one-off used bikes this is fine; the volume
  doesn't justify a constraint.

- **parts**: client-side `qty <= stock` check + the INSERT policy CHECK.
  Stock decrement happens on `fulfilled` (manually today, via Edge Function
  later). For a real e-commerce flow we'd want a Postgres trigger that
  decrements stock atomically; right now the inventory volume is too low
  for that to matter.

If volume grows and overselling becomes a real risk:

- Add a trigger that decrements `parts.stock` on order insert (status='pending'),
  rolls back if `stock < 0`. Cancellations re-increment.
- Add a `bikes_sold` unique partial index on (item_id) where status in
  ('paid', 'fulfilled') and item_type='sale_bike' — at most one paid order
  per sale bike.

Both are additive and don't require a frontend rewrite.

## When you actually wire payment

Concrete checklist for the day you do it:

1. Create a Stripe account, get a test publishable + secret key.
2. Add two columns to `orders`:
   ```sql
   alter table orders add column if not exists payment_session_url text;
   alter table orders add column if not exists payment_session_expires_at timestamptz;
   ```
3. Write an Edge Function `create-checkout-session` that runs on `INSERT` to
   `orders` (via a database webhook or a `pg_net` post). It:
   - Reads the order row.
   - Calls `stripe.checkout.sessions.create({...})` with the right line items.
   - Writes `payment_session_url`, `payment_session_id`, `payment_provider='stripe'`
     back to the order row.
4. Update `sell.js` and `parts.js`: after the insert, `select` the row back,
   read `payment_session_url`, and redirect.
5. Write an Edge Function `stripe-webhook` that:
   - Verifies the signature.
   - On `checkout.session.completed`: `update orders set status='paid', payment_intent_id=...`.
   - On `payment_intent.refunded`: `update orders set status='cancelled'`.
6. Configure the Stripe webhook URL to point at it.
7. Test with Stripe's test card numbers. Flip the keys to production.

Estimated time: ~half a day once you've done a Stripe integration before.

The point is: **none of the above needs the public modules or the admin
page rewritten.** The only public-page change is two added lines after the
order insert, and the admin page already shows the payment fields.
