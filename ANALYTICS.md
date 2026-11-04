# Google Analytics

Measurement ID: `G-G55SW4HLYK` (public identifier).

Only the production home, services and inquiry pages load `/analytics.js`. Preview hosts, monthly report pages, API reviews and URLs containing a `token` parameter are excluded. The analytics page URL is the canonical public path without query strings or fragments. External referrers are reduced to their origin; private internal referrer paths are dropped.

The script sends a page view through the Google tag configuration, disables Google signals and advertising personalization in that configuration, and emits `generate_lead` only after a successful inquiry API response. The lead event contains a constant method label and sanitized page fields; it does not contain submitted answers, names, email addresses or inquiry IDs. An analytics failure must not prevent inquiry submission.

In the GA4 web stream, switch **Enhanced measurement off**. This implementation sends its own page views and lead events. Automatic form, search, click and browser-history tracking is not part of this setup. Do not enable automatic user-provided data collection or advertising integrations without a separate review of the intended data and visitor disclosures/consent requirements.

Standard Google Analytics collection can use cookies and transmit device/network information to Google. This is not a claim of anonymous or cookie-free tracking. Property-level data retention and consent configuration remain controlled in the owner's Analytics account.

To verify collection, visit a public page in an unblocked browser and check the property's Realtime report. Source-code checks establish deployment; they do not prove that Google has received and processed a visit. Browser privacy settings or blockers can prevent collection. No visits or conversions are fabricated by tests.
