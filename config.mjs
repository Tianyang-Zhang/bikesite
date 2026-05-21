// config.mjs — hard-coded settings for the build.
//
// Nothing here is secret: the base ID is just an address. The only secret is
// the Airtable read TOKEN, which lives solely as the AIRTABLE_TOKEN GitHub
// Actions secret.

export const config = {
  // Business timezone. ALL weekend-window math is done in this zone, so a
  // build running just after midnight lands on the right calendar day.
  // IANA name: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
  timezone: 'America/Los_Angeles', // Milpitas, CA

  // How many upcoming Saturday–Sunday weekends to show per bike.
  weekendCount: 4,

  // Page header text.
  businessName: 'self-use-renter',
  tagline: 'Weekend availability at a glance.',

  // Phone number renters text to book, E.164 format (e.g. +14155551234).
  // Leave empty to hide the "Text to book" button entirely.
  contactPhone: '',

  // Static footer text.
  footerNote: 'Updated automatically — check here before you plan your weekend.',

  airtable: {
    // Base ID — not secret (only an address). The read token is the secret.
    baseId: 'appaNlaTgNhwKZYDK',
    bikesTable: 'Bikes',
    bookingsTable: 'Bookings',
  },
};
