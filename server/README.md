# Dainty Bloom API

Express is the single backend for Dainty Bloom. Next.js is a separate
storefront; business rules, price calculations, permissions, and persistence
belong to this API.

## Requirements

- Node.js 20+
- MongoDB

## Setup and run

From this directory, install dependencies and configure `.env`. If `.env`
already exists, edit it in place; do not overwrite it with `.env.example`.
Otherwise, copy `.env.example` to `.env`, then fill required secrets with unique
values of at least 32 characters and configure MongoDB and the frontend origin.
To initialize a new local database, run:

```sh
npm install
npm run db:sync-indexes
npm run categories:sync
npm run dev
```

The API listens on `PORT` (default `3000`). `MONGODB_URI` must point to a running MongoDB instance.

## Custom product requests

Custom product requests require an authenticated customer account. The API
stores the verified account ID on each new request; customer request history
and reference-image access are restricted to that account. Existing requests
without an account link remain available in the admin Messages area and are
not assigned to a customer automatically.

Administrators can move requests from `submitted` to `under_review`, then
`accepted` or `declined`. Acceptance and decline responses are saved before
email delivery is attempted, and each response records whether notification
delivery was sent or failed. Accepted requests remain awaiting a future custom
offer; this workflow does not create products, orders, or payments.

## Environment variables

The checked-in `.env.example` contains placeholders only. Required values have
no safe default; optional settings are shown with their defaults.

| Variable                                                                                   | Purpose                                                                                   |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                 | `development`, `test`, or `production`; default `development`                             |
| `PORT`                                                                                     | HTTP port; default `3000`                                                                 |
| `MONGODB_URI`                                                                              | Required MongoDB connection string                                                        |
| `CLIENT_URL`                                                                               | Required credentialed CORS origin                                                         |
| `API_PUBLIC_URL`                                                                           | Required public API base URL for unsubscribe links                                        |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                                                  | Required independent secrets, at least 32 characters                                      |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`                                                    | Access/refresh token lifetime; defaults `15m` / `7d`                                      |
| `COOKIE_SECRET`                                                                            | Required signed-cookie secret, at least 32 characters                                     |
| `COOKIE_SAMESITE`, `COOKIE_DOMAIN`                                                         | Cookie policy; default SameSite `lax`; domain optional                                    |
| `TRUST_PROXY`                                                                              | Express proxy trust setting (`false`, `true`, hop count, or proxy value); default `false` |
| `BCRYPT_COST`, `PASSWORD_RESET_TTL`                                                        | Password hash cost (default `12`) and reset lifetime (default `15m`)                      |
| `CART_MAX_QUANTITY`                                                                        | Per-line cart cap; default `99`                                                           |
| `UPLOAD_MAX_BYTES`, `PRODUCT_IMAGE_MAX_BYTES`                                              | Private artwork / product image size limits; defaults `10485760`                          |
| `STORAGE_DRIVER`, `STORAGE_PRIVATE_DIR`                                                    | Artwork backend (`local` or `cloudinary`) and local private path; defaults to `local`     |
| `UPLOAD_SIGNING_SECRET`                                                                    | Required signing secret, at least 32 characters                                           |
| `PAYMENT_PROVIDER`                                                                         | `manual` (default) or `stripe`                                                            |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`                     | All required when Stripe is selected; secret and publishable key modes must match         |
| `STRIPE_CHECKOUT_EXPIRY_MINUTES`, `UNPAID_ORDER_EXPIRY_HOURS`                              | Checkout expiry (default 30, minimum 30) and unpaid-order age (default 48)                |
| `CLOUDINARY_URL` or `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary credentials for product images and optional private artwork storage            |
| `DEFAULT_CURRENCY`                                                                         | Must be `GBP`; defaults to `GBP`                                                          |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`                                                  | Optional seed-admin credentials; required by `seed`                                       |
| `CONTACT_RECIPIENT_EMAIL`                                                                  | Explicit destination for general enquiries; required with SMTP settings                   |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`                                                    | SMTP server and TLS mode; Gmail uses `smtp.gmail.com`, port `587`, `false` (STARTTLS)     |
| `SMTP_USERNAME`, `SMTP_PASSWORD`                                                           | Gmail account and Google App Password; both required for Gmail SMTP                       |
| `SMTP_FROM`                                                                                | Verified sender accepted by SMTP; intended business sender is `info@daintybloome.com`     |

The SMTP settings are shared by production transactional mail and general
contact-enquiry delivery. `CONTACT_RECIPIENT_EMAIL` is only the business
destination for general enquiries; customer-facing messages use the recipient
provided by their existing workflow. General contact messages are stored in
MongoDB before delivery is attempted. Contact delivery requires
`CONTACT_RECIPIENT_EMAIL`, `SMTP_HOST`, and `SMTP_FROM`; Gmail SMTP additionally
requires both authentication variables. The recipient must be configured
explicitly. The sender must be verified as an allowed
“Send mail as” address in Gmail or Google Workspace; Cloudflare forwarding is
for inbound mail and does not authorize outbound sending. Until SMTP is
configured, the API retains the enquiry, marks delivery failed, and reports
that email delivery was not confirmed. A stable submission ID prevents
repeated submissions of the same form from creating a second message; a retry
after a recorded failure reuses the saved enquiry. The `sent` status means the
SMTP server accepted the message, not that it reached the recipient's inbox.
When using Gmail SMTP, the API requires `SMTP_FROM` to match
`info@daintybloome.com`.

### Artwork storage

Artwork records select their storage backend using the saved `storageDriver`,
so records stored locally remain readable after Cloudinary is enabled for new
uploads. Setting `STORAGE_DRIVER=cloudinary` routes new artwork uploads to
Cloudinary as authenticated assets; the API serves authorized downloads by
proxying a short-lived private download request and never returns its delivery
URL to the browser. Cloudinary credentials are required when this driver is
selected. Supported private formats are JPEG, PNG, WebP, PDF, and SVG; PDF and
SVG are stored as raw resources. Switching the setting does not migrate files
or rewrite existing artwork records. The cleanup command only scans local
storage for old local orphan files and does not perform a Cloudinary-wide
asset search.
Custom 3D requests are stored for authorised staff and are not sent through the
general-enquiry email workflow.

In production, password resets, order/payment and shipping notifications,
newsletter preference emails, bulk-quote acknowledgements, and staff replies
to customer messages use the configured SMTP mailer. Delivery errors are
logged with a safe error code; sensitive provider details and message content
are not logged. Password-reset API responses remain generic for known and
unknown accounts. Development and test environments retain the console mailer
unless the SMTP mailer is tested directly.

The `Message` model uses a unique sparse index on the contact submission ID.
Apply this index through the approved database-index deployment process before
releasing the frontend retry behavior; do not run index synchronization against
a live database without reviewing its effects.

### Initial production administrator

The seed command is disabled when `NODE_ENV=production`. To provision the
first administrator, run `npm run admin:provision-initial` directly in an
interactive server terminal with the intended environment configured. In
production, the command requires `MONGODB_URI` to contain an explicit database
name and asks the operator to type that name before it connects. It prompts
for the administrator details and reads both password entries without echoing
them; credentials must not be supplied as command-line arguments.

Provisioning uses a MongoDB transaction. It refuses to run when an active
administrator exists or the one-time provisioning marker already exists, and
it records the administrator creation through the normal audit-event model.
The transaction also initializes the staff active-admin counter. Therefore
the configured MongoDB deployment must support transactions (for production,
use a replica set or sharded cluster). No HTTP setup route is provided.

## NPM scripts

| Command                                            | Purpose                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run dev`                                      | Run the API with `tsx` watch mode                                                           |
| `npm run build`                                    | Compile strict TypeScript to `dist`                                                         |
| `npm start`                                        | Run the compiled server                                                                     |
| `npm run lint`                                     | Run ESLint                                                                                  |
| `npm run seed`                                     | Create the initial admin, default settings, and current category tree; never seeds products |
| `npm run admin:provision-initial`                  | Securely provision the first admin from an interactive terminal                             |
| `npm run categories:sync`                          | Ensure current business categories without deactivating old categories                      |
| `npm run categories:sync -- --deactivate-unused`   | Also deactivate the specified legacy categories only when they have no products             |
| `npm run settings:profile`                         | Fill only empty real business-profile settings; production requires `--force`               |
| `npm run currency:migrate:usd-to-gbp -- --dry-run` | Preview the fixed USD-to-GBP migration without writes                                       |
| `npm run currency:migrate:usd-to-gbp -- --dry-run` | Preview the fixed USD-to-GBP migration without writes                                       |
| `npm run expire:unpaid`                            | Expire eligible unpaid orders once                                                          |
| `npm run cleanup:uploads`                          | Clean unattached private uploads once                                                       |
| `npm run artwork:integrity`                        | Read-only report comparing artwork records and local files                                  |
| `npm run artwork:migrate:cloudinary`               | Fail-closed migration authorization preflight; writes remain disabled                       |
| `npm run db:sync-indexes`                          | Synchronize indexes declared by every Mongoose model                                        |
| `npm run routes:list`                              | Regenerate [`docs/api-routes.md`](./docs/api-routes.md) from Express                        |

The route inventory should be regenerated after route or middleware changes and
reviewed before release.

## USD-to-GBP migration

The store currency is GBP. The one-time migration uses the approved fixed rate
of `1 USD = 0.752627 GBP`, converts integer minor-unit amounts with exact
integer rounding to the nearest penny, and does not modify orders. It covers
site-settings shipping amounts and threshold, product base/compare-at prices,
option modifiers and quantity tiers, cart price snapshots, and message quotes
whose stored currency is explicitly USD. Percentage/basis-point values are not
converted. Carts referencing missing products are cleared so stale prices
cannot be charged.

Preview first, from `server`, against the explicitly selected database:

```powershell
npm run currency:migrate:usd-to-gbp -- --dry-run
```

The preview reports only the environment, database name, record counts,
currency counts for historical orders, and a small set of converted minor-unit
examples. It performs no writes. The migration is never run by server startup,
seeding, or deployment.

After reviewing the preview, confirming the target environment/database, and
receiving explicit approval, execute it with:

```powershell
npm run currency:migrate:usd-to-gbp -- --execute --confirm=USD-to-GBP-20261028
```

The migration writes a durable journal before data changes and applies each
record update atomically. If interrupted, the journal and per-record markers
allow safely resuming with:

```powershell
npm run currency:migrate:usd-to-gbp -- --resume --confirm=USD-to-GBP-20261028
```

The migration identifier prevents a second conversion after completion.
Do not run the write command concurrently with storefront/admin writes or
against a different environment than the reviewed preview. Message quotes
created before currency was stored are ambiguous. If any exist, preview stops
and requires manual review rather than assuming or relabelling their currency.
Explicitly USD quotes are converted and marked GBP; explicitly GBP quotes are
left unchanged.

## USD-to-GBP migration

The store currency is GBP. The one-time migration uses the approved fixed rate
of `1 USD = 0.752627 GBP`, converts integer minor-unit amounts with exact
integer rounding to the nearest penny, and does not modify orders. It covers
site-settings shipping amounts and threshold, product base/compare-at prices,
option modifiers and quantity tiers, cart price snapshots, and message quotes
whose stored currency is explicitly USD. Percentage/basis-point values are not converted.
Carts referencing missing products are cleared so stale prices cannot be
charged.

Preview first, from `server`, against the explicitly selected database:

```powershell
npm run currency:migrate:usd-to-gbp -- --dry-run
```

The preview reports only the environment, database name, record counts,
currency counts for historical orders, and a small set of converted minor-unit
examples. It performs no writes. The migration is never run by server startup,
seeding, or deployment.

After reviewing the preview, confirming the target environment/database, and
receiving explicit approval, execute it with:

```powershell
npm run currency:migrate:usd-to-gbp -- --execute --confirm=USD-to-GBP-20261028
```

The migration writes a durable journal before data changes and applies each
record update atomically. If interrupted, the journal and per-record markers
allow safely resuming with:

```powershell
npm run currency:migrate:usd-to-gbp -- --resume --confirm=USD-to-GBP-20261028
```

The migration identifier prevents a second conversion after completion.
Do not run the write command concurrently with storefront/admin writes or
against a different environment than the reviewed preview. Message quotes created before currency was stored are ambiguous. If any exist,
preview stops and requires manual review rather than assuming or relabelling
their currency. Quotes with an explicit USD currency are converted and marked
GBP; explicitly GBP quotes are left unchanged.

## Project structure

```text
src/
  config/       Environment, database, and Stripe configuration
  constants/    Shared domain enumerations and permissions
  controllers/  HTTP request/response handlers
  middleware/   Authentication, authorization, validation, and security
  models/       Mongoose schemas and indexes
  routes/       Express route declarations
  scripts/      Operational scripts
  services/     Business workflows and integrations
  types/        Shared Express and domain typing
  utils/        Errors, logging, and small shared helpers
  validators/   Zod request schemas
  app.ts        Express middleware and route composition
  server.ts     Database startup, timers, and graceful shutdown
```

## Authentication

Authentication uses short-lived access and rotating refresh JWTs in httpOnly
cookies only. Set `COOKIE_SECRET`, `COOKIE_SAMESITE`, optional `COOKIE_DOMAIN`,
`BCRYPT_COST`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, and
`PASSWORD_RESET_TTL` in `.env`. Set `API_PUBLIC_URL` to the public base URL of
the Express API so newsletter unsubscribe links point to the correct service.
State-changing API requests must include
`X-Requested-With: dainty-bloom`; requests from the configured `CLIENT_URL` are
also enforced by credentialed CORS. Production password-reset email uses the
configured SMTP mailer; development and test environments use `ConsoleMailer`,
which does not log reset links or tokens.

Register or log in to receive the cookies, call `/api/auth/me` to read the
current safe profile, and use `/api/auth/refresh` to rotate the session. Logout,
password changes, and password resets invalidate existing tokens. Admin routes use `authenticate` plus `requirePermission`;
`/api/admin/ping` is the guard verification endpoint. Production cookies are
Secure; `COOKIE_SAMESITE` controls the SameSite policy.

### Authentication endpoints

- `POST /api/auth/register` and `POST /api/auth/login` return
  `{ "user": <safe user>, "permissions": <role permission strings> }`.
  Login also sets the access and refresh cookies; registration does not sign in
  the new account. Login accepts optional `portal: "admin"`; customer accounts
  are denied with the same generic invalid-credentials response as a wrong
  password, their failed-login counter is incremented, and no cookies are set.
  This denial is audited as `auth.admin_portal_denied`.
- `POST /api/auth/logout` and `POST /api/auth/refresh`
- `GET /api/auth/me` returns the same safe-user and permission shape;
  `PATCH /api/auth/me` updates the current profile.
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password` accepts `{ "email" }` and returns a generic
  `{ "message" }`. `POST /api/auth/reset-password` accepts `{ "token",
"password" }` and returns `{ "message": "Password reset successfully" }`.
- `GET /api/admin/ping` (requires `analytics:read`)

## Catalog API

Public catalog endpoints are read-only and rate limited. Product list responses
include `data.items`, `data.pagination` (`page`, `limit`, `total`, `totalPages`,
`hasNextPage`), and `data.facets` (`minPrice`, `maxPrice`, `productTypes`,
`printTechniques`, `colors` as `{ value, label, hex? }` records, and `sizes`).
Product cards expose a starting price, primary and optional secondary image
with `thumb`, `medium`, and `large` variants, category, availability, optional
approved-rating summary, and customization cues. Product details include SKU,
available option values, quantity pricing, specifications, artwork
requirements, made-to-order and lead-time fields, min/max order quantities,
category breadcrumbs, related products, and approved-review distribution;
when a product has no configured maximum, the effective `CART_MAX_QUANTITY`
limit is returned as `maxOrderQuantity`. Exact inventory and internal sales
counters are never exposed.

The selectable product types are `tshirt`, `mug`, `canvas_paint_yourself`,
`canvas_custom_print`, `three_d_printed`, and `other`. Existing records using
`hoodie`, `canvas`, `poster`, `tote_bag`, `banner`, `signage`, or `accessory`
remain readable and filterable, but cannot be selected in product write
requests. A paint-it-yourself canvas always has `artworkRequired: false`.
Mugs and T-shirts may be configured with or without customer artwork. The
three-dimensional product option groups are material, colour, size, and finish;
other groups are validated against the selected type. `ecoNote` is plain text
up to 300 characters and is returned only when set. A made-to-order product
reports `availability: "made_to_order"` even when tracked stock is empty;
`leadTimeDays` is included when configured.

- `GET /api/categories` returns active categories as a sorted tree. Each node
  includes an active-product count.
- `GET /api/categories/:slug` returns an active category and breadcrumb.
- `GET /api/products` supports `q`, `category` (including descendants),
  `productType`, `printTechnique`, `minPrice`, `maxPrice`, `color`, `size`,
  `inStock`, `sort` (`newest`, `price_asc`, `price_desc`, `popular`), `page`,
  and `limit` (default 12, maximum 48).
- `GET /api/products/featured` and `GET /api/products/new` accept `limit`
  (default 12, maximum 48).
- `GET /api/products/search-suggestions?q=...` requires at least two
  characters and returns up to eight product/category suggestions.
- `GET /api/products/:idOrSlug` returns active product details. A signed guest
  session cookie deduplicates view increments for 30 minutes.
- `POST /api/products/:idOrSlug/quote` accepts
  `{ "selectedOptions": [{ "key": "...", "value": "..." }], "quantity": 1 }`.
  It uses the same pricing service as cart validation and returns
  `unitPriceMinor`, `lineTotalMinor`, `currency`, `breakdown`, `availability`,
  and `issues`. Invalid selections and quantities, insufficient stock, and
  inactive products are represented by issue codes; unavailable numeric price
  fields and breakdown are `null`. Unknown products return a
  `PRODUCT_UNAVAILABLE` API error. The endpoint is rate limited and protected
  by the standard mutation CSRF guard.
- `GET /api/health` is the liveness check. `GET /api/health/ready` returns
  `{ "success": true, "data": { "ready": true } }` when MongoDB is connected
  and a generic 503 error otherwise.

## Admin product and category API

These endpoints require an authenticated user with the indicated permission.
`admin` has all permissions; product read endpoints require `products:read`,
while all writes and category management require `products:write`. State
changing requests also require the CSRF header documented above.

- `GET /api/admin/products` accepts `q`, `category`, `status`, `minPrice`,
  `maxPrice`, `stockState`, `sort`, `page`, and `limit`. It includes drafts and
  archived records and returns `{ "items": [...], "pagination": { ... } }`
  directly in `data`; each list item's media includes `thumb`, `medium`, and
  `large` variants. A category filter includes products assigned to descendant
  categories.
- `GET /api/admin/products/:id` returns `{ "product": <editable product> }`
  in `data`.
- `POST /api/admin/products` creates a product from the strict product write
  schema; slugs are generated uniquely from the title. Create and update
  responses return `{ "product": ... }` in `data`.
- `PATCH /api/admin/products/:id` partially updates editable product fields;
  server-managed view, sales, and rating counters are not accepted.
- `PATCH /api/admin/products/:id/status` accepts
  `{ "status": "draft|active|archived|out_of_stock" }` and returns
  `{ "product": ... }` in `data`.
- `PATCH /api/admin/products/:id/stock` accepts
  `{ "mode": "set|adjust", "quantity" | "delta", "note" }` and returns
  `{ "product": ... }` in `data`.
- `DELETE /api/admin/products/:id?confirm=true` archives products with order
  history and otherwise hard-deletes them. Its `data` contains `archived` and
  `message`.
- `POST /api/admin/products/bulk-status` accepts up to 100 product ids and a
  status and returns `{ "updated": <count> }`; it does not return per-item
  failure details.
- `GET /api/admin/categories` returns a flat `{ "categories": [...] }` array in
  `data`, with `productCount` on each category. The frontend builds the tree
  from each category's `parent` id. Create and update return
  `{ "category": ... }`; delete returns `{ "message": ... }`. Deletion is
  rejected with `CATEGORY_HAS_PRODUCTS` if products or child categories remain.
- Product image upload returns `{ "media": { "id", "url", "publicId",
"width", "height", "alt", "view", "isPrimary", "sortOrder" } }` in `data`.
  Media updates use the same `data.media` shape; reorder returns
  `{ "reordered": true }` and delete returns `{ "deleted": true }`. Images are
  checked by file signature and dimensions on the server; Cloudinary must be
  configured for uploads.

Successful API responses use `{ "success": true, "data": ... }`; errors use the
centralized `{ "success": false, "error": { "code", "message", "details" } }`
shape.

## Cart and wishlist API

Cart and wishlist routes support both signed-in users and guests. The signed
`guestSessionId` cookie scopes guest data; after login, the guest cart and
wishlist are merged automatically (or the cart can be merged explicitly).
Checkout eligibility is intentionally not enforced by these endpoints. Expired
guest carts are removed through the Cart TTL index; in deployments where MongoDB
TTL cleanup timing needs oversight, monitor the collection and allow for the
index's asynchronous cleanup rather than relying on an exact expiration time.

- `GET /api/cart` returns `{ items, totals, hasBlockingIssues }`. Each line
  contains `itemId`, `productId`, `slug`, `title`, `image`, labeled
  `selectedOptions`, `quantity`, live `unitPriceMinor` and `lineTotalMinor`,
  `artworkStatus`, `availability`, and `issues`. `PRICE_CHANGED` issues carry
  `oldPriceMinor` and `newPriceMinor`; other blocking issues include
  `PRODUCT_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `ARTWORK_REQUIRED`, and
  `OPTION_NO_LONGER_AVAILABLE`. Totals contain `subtotalMinor`, `discountMinor`,
  `estimatedShippingMinor` (`null`), `shippingCalculatedAtCheckout` (`true`),
  `totalMinor`, `currency`, and `itemCount`.
- `GET /api/cart/summary` returns `{ itemCount, subtotalMinor, currency,
wishlistCount }` for header use.
- `POST /api/cart/items` accepts `{ productId, selectedOptions, quantity,
artworkId? }`; prices and totals are not accepted from the client.
- `PATCH /api/cart/items/:itemId` accepts quantity, selected options, and/or an
  artwork id. Quantity must be positive; use `DELETE` to remove a line.
- `DELETE /api/cart/items/:itemId` removes one line; `DELETE /api/cart` clears
  the cart.
- `POST /api/cart/validate` re-prices and checks the cart without modifying it.
- `POST /api/cart/merge` merges the current guest cart into the signed-in user's
  cart. Login invokes the same operation automatically.
- `GET /api/wishlist` returns active saved products as catalog cards and a
  `removedCount` for inactive/missing saved products.
- `POST /api/wishlist/items` accepts `{ productId }`; repeated additions are
  idempotent. `DELETE /api/wishlist/items/:productId` removes a saved product.
- `GET /api/wishlist/count` returns `{ count }`.
- `POST /api/wishlist/move-to-cart` accepts `{ productId, selectedOptions,
quantity }`, validates and adds the product to the cart, then removes it from
  the wishlist.

Cart and wishlist writes are rate limited and require the CSRF header. A cart
can contain at most 50 lines; per-line quantity is capped by `CART_MAX_QUANTITY`.
Discount calculation currently returns zero until promotion rules are defined.
Checkout uses configurable shipping and tax values from SiteSettings and marks
whether those values have been configured so the storefront can communicate
uncertain totals.

## Product images and customer artwork

Product images are public delivery assets stored in Cloudinary. Configure
`CLOUDINARY_URL` or all of `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET`. With no Cloudinary credentials, the API still starts;
admin product-image endpoints return `IMAGE_STORAGE_NOT_CONFIGURED` (503).
Uploads are signed by the server, limited to 10 MB (or less via
`PRODUCT_IMAGE_MAX_BYTES`), and accept JPEG, PNG, and WebP only. Images must be
at least 600 pixels on their shortest side. The Next.js image configuration
must allow `res.cloudinary.com`; helmet/CORS does not serve or proxy those
images.

- `POST /api/admin/products/:id/media` (multipart field `file`, plus required
  `alt` and `view`, optional `isPrimary`) uploads an image and returns
  `{ "success": true, "data": { "media": { "id", "url", "publicId", "width", "height", "alt", "view", "isPrimary", "sortOrder" } } }`.
- `PATCH /api/admin/products/:id/media/:mediaId` updates `alt`, `view`,
  `isPrimary`, and/or `sortOrder`.
- `PUT /api/admin/products/:id/media/order` accepts
  `{ "mediaIds": ["..."] }` containing every media id exactly once.
- `DELETE /api/admin/products/:id/media/:mediaId` deletes a Cloudinary image;
  the last image of an active product cannot be removed. Deleting a product
  with no order history also deletes its Cloudinary images; products archived
  to preserve order history retain their images.

### Lamp ON/OFF gallery backend contract

Products may opt in with `lightingGalleryEnabled: true`, and each configured
image must have `lightingState: "on"` or `"off"`. The feature is eligible only
when the persisted product category has slug `lamps-and-lighting` and profile
`three_d_printed`; the request cannot establish eligibility by supplying a
profile or category name. Drafts may be enabled before adding images. Activation
requires at least one image and exactly one primary image in each configured
state. Each state may be absent; an absent state has no primary requirement.
Ordinary products retain the existing single-primary rule. The total remains
limited to 10 images across both states, and legacy media without a lighting
state is not assigned or rewritten.

The dedicated media endpoints do not yet accept or manage `lightingState`.
Before enabling ON/OFF image editing in Stage 2, their upload and metadata
update operations must preserve and validate the state, primary selection must
be scoped to its state, and deletion must not disturb the other state's
primary. Reordering must continue to accept every product media ID exactly
once and preserve the existing product-wide ordering contract; the 10-image
limit remains combined across both states.

Customer artwork is stored privately using the `STORAGE_DRIVER=local`
implementation, under `STORAGE_PRIVATE_DIR` (default `./storage/private`).
That directory is not exposed by Express and must not be configured as a
public/static directory. `UPLOAD_SIGNING_SECRET` must be a random secret of at
least 32 characters. The per-file limit is the lower of SiteSettings
`artworkLimits.maxBytes` and `UPLOAD_MAX_BYTES`. Allowed types come from
SiteSettings `artworkLimits.allowedMimeTypes`; if empty, PNG, JPEG, PDF, and
validated SVG are allowed. Raster dimensions are stored as file facts and do
not represent a DPI or print-quality assessment. SVGs are never rendered
inline.

- `POST /api/artwork` accepts exactly one multipart file in field `file` and
  returns `{ "success": true, "data": { "id", "originalFilename", "sizeBytes", "detectedMimeType", "width", "height", "reviewStatus", "createdAt" } }`.
- `GET /api/artwork/:id` returns the same metadata to its owner or artwork
  reviewers. `GET /api/artwork/:id/file` streams an attachment to those same
  authorized users; storage keys and file URLs are never returned.
- `DELETE /api/artwork/:id` deletes the owner's asset unless it is attached to
  an order. Cart references are cleared when an eligible asset is deleted.
- `POST /api/artwork/:id/download-link` requires `artwork:review` and returns
  `{ "success": true, "data": { "downloadUrl": "/api/artwork/signed/:token", "expiresAt": "..." } }`.
  The signed URL is valid for five minutes and streams only as an attachment.
- `GET /api/admin/artwork` requires `artwork:review` and supports `page`,
  `limit`, `reviewStatus`, `from`, `to`, and `orderNumber`. Admin detail is
  `GET /api/admin/artwork/:id`; reviewers submit
  `PATCH /api/admin/artwork/:id/review` with
  `{ "decision": "approved|replacement_requested", "note": "..." }` (the note
  is required for replacement requests).

Private storage cleanup runs hourly in production. Run
`npm run cleanup:uploads` for an explicit cleanup; it removes unattached
artwork older than 24 hours and private files with no database record. The
orphan-file sweep waits 24 hours from the file's modification time and skips
uploads active in the current process. This coordination is process-local;
local storage cleanup is intended for a single backend instance.

Run `npm run artwork:integrity` from the backend directory in an explicitly
approved environment to produce a read-only JSON report. It compares local
artwork records and files, streams SHA-256 checksums, and for Cloudinary
records checks authenticated-resource existence, available resource type,
delivery type and byte size, then streams the private asset for its checksum.
It reports unsupported storage drivers, missing/unreadable files, invalid
keys, checksum or metadata mismatches, provider errors, and local orphan files.
Unknown or unavailable metadata is not considered verified. Cloudinary asset
enumeration is not performed, so unrelated provider-side orphan assets are not
reported. The checker does not repair, delete, or change files or database
records. It exits with status 2 when findings or filesystem errors are present
and status 1 when the check cannot run. The report includes artwork record IDs
and safe storage keys; protect its output as operational data. Do not run it
against production without approval.

### Operator-invoked local artwork migration

The migration CLI now has a fail-closed authorization preflight and a separate
Mongoose connection. Its configuration is independent of `MONGODB_URI`; URI
user information and query options are rejected. The connection requires TLS,
the configured CA, certificate and hostname validation, a direct standalone
topology, and disabled Mongoose automatic collection/index creation. After
connecting it checks the database name, runs the public MongoDB `hello`
command, and reads a signed identity marker on that same connection. The
marker is a consistency check; TLS certificate validation and the signed
authorization are the server-identity controls.

The required migration configuration names are:

- `ARTWORK_MIGRATION_MONGODB_URI`
- `ARTWORK_MIGRATION_DEPLOYMENT_ID`
- `ARTWORK_MIGRATION_DATABASE_NAME`
- `ARTWORK_MIGRATION_DATABASE_ROLE`
- `ARTWORK_MIGRATION_TLS_SERVER_HOSTNAME`
- `ARTWORK_MIGRATION_TLS_CA_FILE`
- `ARTWORK_MIGRATION_AUTHORIZATION_MANIFEST_FILE`
- `ARTWORK_MIGRATION_AUTHORIZATION_PUBLIC_KEY_FILE`
- `ARTWORK_MIGRATION_RUN_ID`
- `ARTWORK_MIGRATION_AUTHORIZATION_EXPIRES_AT`
- `ARTWORK_MIGRATION_OPERATION`
- `ARTWORK_MIGRATION_MONGODB_CREDENTIAL_REF`
- `ARTWORK_MIGRATION_SOURCE_PRIVATE_DIR`
- `ARTWORK_MIGRATION_UPLOAD_MAX_BYTES`

The MongoDB credential reference currently supports a `file:` URL to a
dedicated JSON credential file with username, password, authentication source,
and role-name fields. The signed manifest and configuration bind the exact
`artwork_migration` role; the connected user's reported authentication identity,
role, and effective privileges are checked before the marker read. It never
falls back to application credentials or `.env`.
Credential files must be unique to the isolated deployment, outside the
repository, access-controlled to the migration operator, rotated after use,
and revoked when the isolated environment is discarded. Windows file ACLs are
not verified by this implementation, so credential-file resolution is refused
on Windows.

Authorization manifest version 1 is strict JSON with `version`, `payload`, and
an unpadded base64url `signature`. The Ed25519 signature covers the canonical
JSON encoding of `{ version, payload }` (object keys sorted recursively).
The payload contains `deploymentIdentity`, `databaseName`, `databaseRole`,
`tlsServerHostname`, `runId`, `operation`, `issuedAt`, `expiresAt`, and
`identityMarker`. The marker identifies `_migrationIdentity` /
`artwork-migration` and binds the deployment, database, and marker version.
The run ID must be a UUID. The authorization is rejected when expired,
contradictory, issued too far in the future, or longer than eight hours.
Provision the signing key outside this repository; distribute the trusted
public key and isolated CA to the migration runtime through a separately
controlled channel. Test keys are generated in memory by the unit tests only.

The migration database user must exist only in the isolated deployment. Its
role should grant `find` on `_migrationIdentity` and the actual
`ArtworkAsset.collection.name`, and `update` on that artwork collection for the
conditional storage-field update. The runtime verifies the exact privilege
resources/actions and rejects extra roles or privileges. The role definition
must still be independently audited before provisioning. It needs no collection
creation, index creation, insert, delete, or unrelated application-data
privileges. The current model resolves its collection from the explicit
`artworkassets` collection setting; verify the deployed collection name before
provisioning the role. Provision,
rotate, revoke, and audit this account outside the repository. The repository
cannot determine whether a secret value was reused elsewhere; unique
credential provisioning remains an infrastructure requirement.

Cloudinary migration configuration is separate from application Cloudinary
configuration:
`ARTWORK_MIGRATION_CLOUDINARY_CLOUD_NAME`,
`ARTWORK_MIGRATION_CLOUDINARY_ACCOUNT_ID`,
`ARTWORK_MIGRATION_CLOUDINARY_API_KEY`, and
`ARTWORK_MIGRATION_CLOUDINARY_API_SECRET`. The installed SDK path used by the
application is a shared configured singleton, and the available Admin API
responses do not provide a verified account-identity binding suitable for
this safeguard. Therefore the migration identity verifier deliberately fails
with `MIGRATION_CLOUDINARY_ACCOUNT_IDENTITY_UNVERIFIABLE`; it does not
initialize the SDK, read artwork records, upload, or open the journal. A
dedicated test account, authenticated/private delivery, deterministic asset
IDs, `overwrite: false`, metadata/checksum verification, and no automatic
migration deletion remain required before provider operations can be enabled.
Ordinary application Cloudinary configuration is initialized lazily on its
first normal use and retains its existing configuration behavior.
The exported migration service rejects direct dry-run calls with
`MIGRATION_SIGNED_PREFLIGHT_REQUIRED` before accessing the database, journal, or
storage dependencies. It cannot be used to bypass the signed CLI preflight or
implicitly use ordinary application Cloudinary credentials. The authorized
CLI currently stops at the Cloudinary identity check, so no migration service
execution path is enabled.

`MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN` remains effective in the
CLI and direct migration service calls. `--write` is rejected before config,
credential, journal, database, or provider access. The current CLI is also
blocked before journal/provider/artwork access because provider identity cannot
be verified. No real migration, MongoDB, Cloudinary, TLS endpoint, network
boundary, or deployment has been tested or authorized.

Run the local authorization tests with:

```sh
npm test -- tests/artworkMigrationAuthorization.test.ts
```

Infrastructure work still required before reconsidering migration includes:
create/discard an isolated database deployment with no production network
route; provision a deployment-specific CA and hostname certificate; confirm
runtime DNS, TLS/SAN, and topology through an isolated integration test;
provision the marker and least-privilege migration role manually; protect and
revoke the credential and signing authority; and establish a supported
Cloudinary account identity proof or keep provider operations disabled.
Mocks and local fixtures cannot verify those controls. The current code is not
authorization to run the migration.

If writes are re-enabled after that separate review, migration requires
configured Cloudinary credentials and an available, non-symlink private
source directory. It would keep a durable line-delimited JSON
journal at `~/.dainty-bloom/artwork-cloudinary-migration.json` (on Windows,
under the operator's home directory) and an exclusive sibling migration lock.
The journal contains target identity, record IDs, per-attempt IDs, storage
keys, checksums, phases, and safe failure codes; it contains no credentials or
delivery URLs. Phase transitions are monotonic within an attempt; stale and
out-of-order events fail closed, while an explicit new attempt is required to
resume a failed or reconciliation-required entry. The exported service holds
the migration lock for the full run, and a separate short-lived exclusive
journal-write lock protects recovery and appends. Contention fails closed.
Process interruption may leave either lock stale; do not remove a stale lock
or edit the journal until its interrupted operation has been reviewed.

Only a final fragment that is a valid, schema-compatible prefix of a serialized
journal event can be discarded. Invalid tokens, field values, malformed
complete events, and fragments that cannot be proven to be valid event
prefixes are preserved and fail closed. A valid final entry without its
newline is preserved.
Recovery first writes and syncs a temporary copy containing the verified valid
prefix, then atomically renames it over the journal; an interruption before
replacement leaves the original journal intact and can be retried. Malformed
complete events, malformed headers, and corruption before the final event stop
execution. An ambiguous unterminated fragment fails closed without changing
the journal; preserve a copy and have an operator inspect and recover it
manually before retrying.

The retained write implementation uses record-derived deterministic Cloudinary IDs with
authenticated delivery and `overwrite=false`. On resume it checks that ID
before uploading, then verifies provider ID, authenticated delivery, resource
type, byte size, and streamed SHA-256. It updates only the existing record's
storage fields with a conditional filter on its ID, local driver, source key,
checksum, resource type, byte size, and detected MIME type. A concurrent change
to any source-snapshot field is a reconciliation conflict; ownership and all
relationship/history fields remain unchanged.
The retained write implementation never deletes local source files.
Migration-specific uploads and recovery never delete Cloudinary assets;
unexpected upload metadata remains a
reconciliation concern. Source validation rejects traversal and detected
symlinks, checks the opened file's identity and metadata, and re-reads and
revalidates the source immediately before upload. On Windows, Node.js does not
provide the same usable `O_NOFOLLOW` protection as on supported POSIX
platforms. The utility therefore checks path components with `lstat` and
`realpath`, compares the opened handle's file type, device, and inode identity
with the path's metadata, and checks size, timestamps, type, and SHA-256; it
repeats source validation immediately before upload. If these identity values
cannot be established, migration fails closed. These checks reduce pathname
and replacement risks but cannot eliminate the race between final validation
and upload, or guarantee safety against a hostile actor able to change the
filesystem concurrently. Do not treat pathname checks, even with checksums,
as an absolute filesystem guarantee. Uploads whose outcome is uncertain,
metadata failures, and database conflicts remain visible as reconciliation or
unverifiable findings; they must not be resolved by blindly reverting a
record to local storage. A nonzero exit indicates failed,
unverifiable, reconciliation, or remaining-local records. Orphan cleanup is
a separate operation and is not part of this utility.

Before any real migration is authorized, first complete a separately reviewed
environment-authorization design, then validate the procedure against an
isolated non-production copy with backups and restore testing. Review the dry
run, confirm storage capacity and Cloudinary format/account behavior, execute
in a controlled batch, verify the migration report and
`npm run artwork:integrity`, and retain both local sources and the journal
through sign-off. Production execution remains unsupported until a distinct
security review and explicit authorization design are approved.

## Settings, checkout, orders, and production

All state-changing endpoints require `X-Requested-With: dainty-bloom` and the
configured credentialed CORS origin. JSON responses use the common
`{ "success": true, "data": ... }` envelope. Checkout totals are recalculated
from the cart, server-side product prices, and SiteSettings; client prices,
totals, and statuses are not accepted. Shipping and tax amounts default to
zero, and `shippingConfigured`/`taxConfigured` indicate whether the values
have been configured. The active payment provider defaults to `manual` and
never collects or stores card data. Staff record payment through the admin API.

### Settings

- `GET /api/settings/public` is public and returns store name, currency,
  country, announcement bar, turnaround message, contact details/opening
  hours, `productLines`, `guestCheckoutEnabled`, `shippingConfigured`, and the
  Stripe publishable key (or `null` for the manual provider). It also returns
  `artwork: { maxBytes, allowedMimeTypes }`, using the upload service's default
  formats and the configured effective size limit.
- `GET /api/admin/settings` and `PATCH /api/admin/settings` require
  `settings:write`. PATCH accepts validated settings fields including checkout
  shipping/tax configuration, store content and contact details, guest
  checkout, and artwork limits. Each update is audited.

### Customer checkout and orders

- `GET /api/checkout/preview` uses the guest session or signed-in cart and
  returns priced lines, totals, currency, issues, `hasBlockingIssues`,
  `shippingConfigured`, and `taxConfigured`.
- `POST /api/orders` uses the same identity, requires a UUID
  `Idempotency-Key` header, and accepts `contact`, `shippingAddress`,
  `billingAddress` or `billingSameAsShipping`, and optional `customerNote`.
  The server validates cart contents, artwork ownership, current pricing and
  stock, reserves tracked inventory, creates a `pending_payment` order, and
  clears the cart.
- `GET /api/orders` requires authentication; accepts `page`, `limit`, and
  `status`, and returns the user's paginated order summaries.
- `GET /api/orders/:orderNumber` requires the authenticated owner and returns
  customer-safe detail. `POST /api/orders/lookup` is public and accepts
  `{ "orderNumber", "email" }` for guest orders; it is strictly rate limited
  and returns a generic lookup failure for invalid order/email pairs.
- `POST /api/orders/:orderNumber/items/:itemId/artwork` replaces an artwork
  file while a proof is rejected. Signed-in owners submit `artworkId`; guest
  owners also submit the guest order's `email`.
- `POST /api/orders/:orderNumber/cancel` is owner-only and accepts an email
  for guest orders. Customer cancellation is limited to
  `pending_payment`, `pending_proof_approval`, or `artwork_rejected`.

`GET /api/orders/:orderNumber` returns this exact customer-safe shape (optional
phone, reviewNote, and shipment fields are omitted when unavailable):

```json
{
  "success": true,
  "data": {
    "order": {
      "orderNumber": "DB-EXAMPLE",
      "status": "pending_proof_approval",
      "payment": { "status": "paid" },
      "contact": {
        "name": "Customer",
        "email": "customer@example.invalid",
        "phone": null
      },
      "shippingAddress": {
        "line1": "Address line",
        "city": "City",
        "state": "Region",
        "postalCode": "00000",
        "country": "Country"
      },
      "billingAddress": {
        "line1": "Address line",
        "city": "City",
        "state": "Region",
        "postalCode": "00000",
        "country": "Country"
      },
      "items": [
        {
          "id": "000000000000000000000001",
          "title": "Product title",
          "sku": "SKU",
          "selectedOptions": [],
          "quantity": 1,
          "unitPriceMinor": 1000,
          "lineTotalMinor": 1000,
          "artwork": {
            "id": "000000000000000000000002",
            "reviewStatus": "pending"
          }
        }
      ],
      "totals": {
        "subtotalMinor": 1000,
        "discountMinor": 0,
        "shippingMinor": 0,
        "taxMinor": 0,
        "totalMinor": 1000,
        "currency": "GBP"
      },
      "statusHistory": [
        {
          "from": "pending_payment",
          "to": "pending_payment",
          "at": "2025-01-01T00:00:00.000Z"
        }
      ],
      "shipment": null,
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  }
}
```

### Admin orders and production

Admin order access requires authentication and the permission shown:

- `GET /api/admin/orders` (`orders:read`) accepts pagination, status tab,
  search, date range, and sort filters; returns order rows, pagination, and
  counts for all status tabs.
- `GET /api/admin/orders/:id` (`orders:read`) returns full order, payment,
  shipment, artwork metadata (never file URLs), actor names, internal notes,
  refunds, and `allowedNextStatuses`.
- `PATCH /api/admin/orders/:id/status` (`orders:update_status`) accepts
  `{ "status", "note" }`; shipment and cancellation must use their dedicated
  endpoints. Transitions are checked and atomically recorded.
- `POST /api/admin/orders/:id/payment` (`orders:update_status`) accepts
  `{ "status": "paid|failed", "reference", "amountMinor", "method", "note" }`.
  A paid amount must equal the order total. Recording payment increments
  product sold counts and moves the order to proof approval or printing.
- `POST /api/admin/orders/:id/items/:itemId/proof` (`artwork:review`) accepts
  `{ "decision": "approved|replacement_requested", "note" }`. Replacement
  requests require a note. The artwork review endpoint
  `PATCH /api/admin/artwork/:id/review` uses this same proof workflow.
- `PATCH /api/admin/orders/:id/items/:itemId/print-status`
  (`orders:update_status`) accepts `{ "status", "note" }` where status is
  `queued`, `printing`, `printed`, `quality_check`, or `ready`. When every item
  is ready, the order moves to ready.
- `POST /api/admin/orders/:id/dispatch` (`orders:update_status`) accepts
  `{ "carrier", "trackingNumber", "trackingUrl", "note" }`; it records the
  shipment before moving the order to shipped and notifying the customer.
- `POST /api/admin/orders/:id/complete` (`orders:update_status`) completes a
  shipped order.
- `POST /api/admin/orders/:id/cancel` (`orders:update_status`) accepts
  `{ "reason", "restock" }`. Cancelling an order in printing is admin-only.
- `POST /api/admin/orders/:id/refund` (`orders:refund`, admin only) accepts
  `{ "amountMinor", "reason", "reference" }`; refunds are capped by the paid
  amount less prior refunds. The manual provider records no external payment.
- `POST /api/admin/orders/:id/notes` (`orders:update_status`) accepts
  `{ "note" }`; internal notes are not returned to customers.
- `GET /api/admin/print-queue` (`orders:read`) lists oldest-first items from
  printing and ready orders; optional filters are `technique` and `status`.
- `GET /api/admin/customers` and `GET /api/admin/customers/:id`
  (`customers:read`) return paginated customer totals and order history without
  password or credential fields.

`GET /api/admin/orders/:id` returns the following shape; fields inside each
item's `artwork` object are only present when artwork is attached:

```json
{
  "success": true,
  "data": {
    "order": {
      "id": "000000000000000000000001",
      "orderNumber": "DB-EXAMPLE",
      "status": "in_printing",
      "allowedNextStatuses": ["ready", "cancelled"],
      "contact": {
        "name": "Customer",
        "email": "customer@example.invalid",
        "phone": null
      },
      "guestEmail": null,
      "customerNote": null,
      "shippingAddress": {
        "line1": "Address line",
        "city": "City",
        "state": "Region",
        "postalCode": "00000",
        "country": "Country"
      },
      "billingAddress": {
        "line1": "Address line",
        "city": "City",
        "state": "Region",
        "postalCode": "00000",
        "country": "Country"
      },
      "items": [
        {
          "id": "000000000000000000000002",
          "productId": "000000000000000000000003",
          "title": "Product title",
          "sku": "SKU",
          "selectedOptions": [],
          "quantity": 1,
          "unitPriceMinor": 1000,
          "lineTotalMinor": 1000,
          "itemPrintStatus": "queued",
          "printTechniques": [],
          "artwork": {
            "id": "000000000000000000000004",
            "originalFilename": "artwork.png",
            "detectedMimeType": "image/png",
            "sizeBytes": 1024,
            "width": 800,
            "height": 800,
            "reviewStatus": "approved",
            "reviewNote": null
          }
        }
      ],
      "totals": {
        "subtotalMinor": 1000,
        "discountMinor": 0,
        "shippingMinor": 0,
        "taxMinor": 0,
        "totalMinor": 1000,
        "currency": "GBP"
      },
      "payment": {
        "provider": "manual",
        "providerReference": null,
        "status": "paid",
        "paidAt": "2025-01-01T00:00:00.000Z"
      },
      "shipment": null,
      "statusHistory": [
        {
          "from": "pending_payment",
          "to": "in_printing",
          "actorName": "Admin",
          "note": "Payment recorded",
          "at": "2025-01-01T00:00:00.000Z"
        }
      ],
      "internalNotes": [],
      "refunds": [],
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  }
}
```

Order status transitions are intentionally restricted to:

```text
pending_payment        -> pending_proof_approval | in_printing | cancelled
pending_proof_approval -> artwork_rejected | in_printing | cancelled
artwork_rejected       -> pending_proof_approval | cancelled
in_printing            -> ready | cancelled (admin-only cancellation)
ready                  -> shipped (dispatch endpoint only)
shipped                -> completed
completed              -> (terminal)
cancelled              -> (terminal)
```

## Messages, reviews, analytics, staff, FAQs, and newsletter

All API responses use the standard `{ "success": true, "data": ... }` envelope.
Errors use `{ "success": false, "error": { "code", "message", "details" } }`.
User-supplied text is validated as plain text; HTML is rejected.

### Endpoint access

| Endpoint                                            | Access                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/messages/token`                           | Public; rate limited                                                                             |
| `POST /api/messages`                                | Public; ordinary messages allow guests; custom requests require a signed-in customer             |
| `GET /api/messages/custom-requests`                 | Authenticated customer; only that account's requests                                             |
| `GET /api/messages/custom-requests/:id`             | Authenticated owner; request, responses, and any private offer                                   |
| `GET /api/messages/custom-requests/:id/offer-image` | Authenticated owner; private mockup stream                                                       |
| `GET /api/admin/messages`                           | `messages:manage`                                                                                |
| `GET /api/admin/messages/:id`                       | `messages:manage`                                                                                |
| `POST /api/admin/messages/:id/custom-offer`         | Admin with `messages:manage`; multipart image and agreed offer terms                             |
| `GET /api/admin/messages/:id/custom-offer/image`    | `messages:manage`; audited private mockup stream                                                 |
| `PATCH /api/admin/messages/:id`                     | `messages:manage`                                                                                |
| `POST /api/admin/messages/:id/reply`                | `messages:manage`                                                                                |
| `GET /api/admin/messages/:id/attachment`            | `messages:manage`; audited private download                                                      |
| `DELETE /api/admin/messages/:id`                    | Admin; `messages:manage`                                                                         |
| `GET /api/products/:idOrSlug/reviews`               | Public; approved reviews only                                                                    |
| `GET /api/products/:idOrSlug/reviews/eligibility`   | Authenticated customer                                                                           |
| `POST /api/products/:idOrSlug/reviews`              | Authenticated customer; rate limited                                                             |
| `PATCH /api/reviews/:id`                            | Authenticated review owner                                                                       |
| `DELETE /api/reviews/:id`                           | Authenticated review owner                                                                       |
| `GET /api/admin/reviews`                            | `reviews:moderate`                                                                               |
| `PATCH /api/admin/reviews/:id/moderate`             | `reviews:moderate`                                                                               |
| `DELETE /api/admin/reviews/:id`                     | Admin; `reviews:moderate`                                                                        |
| `GET /api/admin/dashboard`                          | `analytics:read`                                                                                 |
| `GET /api/admin/analytics/sales`                    | `analytics:read`                                                                                 |
| `GET /api/admin/analytics/products`                 | `analytics:read`                                                                                 |
| `GET /api/admin/analytics/customers`                | `analytics:read`; PII is returned only with `customers:read`                                     |
| `GET /api/admin/analytics/production`               | `analytics:read`                                                                                 |
| `GET /api/admin/notifications`                      | `analytics:read`                                                                                 |
| `GET /api/admin/search`                             | Authenticated staff; groups require their corresponding read/management permission; rate limited |
| `GET /api/admin/staff`                              | `staff:manage` (admin)                                                                           |
| `POST /api/admin/staff`                             | `staff:manage` (admin)                                                                           |
| `PATCH /api/admin/staff/:id`                        | `staff:manage` (admin)                                                                           |
| `GET /api/admin/audit`                              | `audit:read` (admin)                                                                             |
| `GET /api/faqs`                                     | Public; published FAQs only                                                                      |
| `GET /api/admin/faqs`                               | `settings:write`                                                                                 |
| `POST /api/admin/faqs`                              | `settings:write`                                                                                 |
| `PATCH /api/admin/faqs/:id`                         | `settings:write`                                                                                 |
| `DELETE /api/admin/faqs/:id`                        | `settings:write`                                                                                 |
| `POST /api/newsletter/subscribe`                    | Public; rate limited; explicit consent required                                                  |
| `GET /api/newsletter/unsubscribe?token=...`         | Public; rate limited; token is single-use by replacement                                         |
| `GET /api/admin/subscribers`                        | `customers:read`                                                                                 |

Message submission requires a signed token from `GET /api/messages/token`.
Tokens expire after 10 minutes and submissions must wait at least 3 seconds.
Token acquisition and message submission share a limit of five requests per
client IP in 15 minutes. The storefront shares an in-flight token request to
avoid duplicate development-mode requests.
The honeypot field is `website`; when filled, the request is silently discarded
with the same generic success response. Contact attachments use the existing
private upload pipeline and are never exposed as public URLs. A
`custom_3d_request` additionally accepts `requestDetails` as JSON with required
`description` (20-2000 characters), and optional `approximateSize`,
`preferredColour`, `preferredMaterial`, positive integer `quantity`, and
`neededByDate`. Its optional multipart `referenceImage` must be a verified
JPEG, PNG, or WebP file and remains private. `bulk_quote` accepts the
structured request details; general messages reject them. The admin list
supports `type` and `status` filters, and detail includes request details and
private attachment metadata. Admin replies may include `quotedPriceMinor` and
a customer-facing `note`; supplying a quote changes status to `quoted`. Quotes
do not create orders. IP addresses are stored only as an HMAC hash.

An administrator may create one private offer from an accepted custom request
only when it belongs to an active customer account. The customer ID comes from
the stored request, not the submission. The request, offer, private Product,
and private ArtworkAsset are linked; a unique request index prevents duplicate
offers, including concurrent submissions. The mockup is stored through the
private artwork driver and is streamed only through request-scoped admin or
customer routes. It is never attached to public product media.

Offer price is fixed in GBP minor units and represents the agreed total for the
offer; the agreed production quantity is recorded separately. Offer products
are active but explicitly private, use a single package quantity, and are
protected from ordinary product edits, status/stock changes, media changes, and
deletion. Public catalogue, cart, wishlist, review, and quote flows continue
excluding private products. This stage does not create a checkout button, cart
line, order, Stripe session, or payment; customers can review the offer and its
status in their custom-request history only.

### Review policy and response

Only a signed-in customer with an order containing the product in `shipped` or
`completed` status can review it. A user may create one review per product.
New and edited reviews are `pending` until moderated. Public responses include
approved reviews only and expose the reviewer as first name plus last initial,
never email. Product `ratingAverage` and `ratingCount` are recalculated from
approved reviews after every edit, deletion, or moderation change; public
catalog ratings are shown only when `ratingCount > 0`.

`GET /api/products/:idOrSlug/reviews` returns this exact field shape (the
strings below describe value types, not sample records):

```json
{
  "success": true,
  "data": {
    "productId": "<ObjectId>",
    "items": [
      {
        "id": "<ObjectId>",
        "reviewerName": "<first name and last initial>",
        "rating": "<number from 1 to 5>",
        "title": "<plain text>",
        "body": "<plain text>",
        "verifiedPurchase": true,
        "date": "<ISO-8601 datetime>"
      }
    ],
    "summary": {
      "average": "<number or null>",
      "count": "<number>",
      "distribution": {
        "1": "<number>",
        "2": "<number>",
        "3": "<number>",
        "4": "<number>",
        "5": "<number>"
      }
    },
    "pagination": {
      "page": "<number>",
      "limit": "<number>",
      "total": "<number>",
      "totalPages": "<number>",
      "hasNextPage": "<boolean>"
    }
  }
}
```

The review list accepts `page`, `limit`, and `sort=newest|highest|lowest`.
Eligibility returns `{ "canReview": boolean, "reason": string|null,
"existingReview": object|null }`.

### Dashboard response and metric definitions

`GET /api/admin/dashboard?range=7d|30d|90d&tz=...` defaults to `range=30d`
and `tz=UTC`. Its dates and daily buckets use the requested timezone. The
period is the current local calendar day plus the preceding `range - 1` days.
All monetary values are minor currency units and revenue analytics include
orders denominated in the current SiteSettings currency.

- **New orders**: count of orders created in the selected period, across all
  statuses.
- **Revenue**: `totalMinor` for paid orders created in the period, minus their
  recorded refunds; cancelled orders are excluded.
- **Average order value**: period revenue divided by the number of paid orders
  in the period. It is `null` when there are no paid orders.
- **Popular products**: units in paid orders created in the period, grouped by
  product.
- **Views**: the persisted `Product.viewCount`, which is deduplicated by
  session by the catalog view-count logic.
- **Low/out of stock**: active tracked-inventory products compared with their
  configured stock quantity and low-stock threshold.
- **Revenue comparison**: percentage change against the immediately preceding
  equal-length local-calendar period. It is `null` when the previous period
  has no paid orders or a percentage cannot be computed from zero revenue.

The dashboard response has this exact shape; each `<...>` denotes the runtime
value type, and `ordersByStatus` contains every current order status:

```json
{
  "success": true,
  "data": {
    "range": "7d|30d|90d",
    "timezone": "<IANA timezone>",
    "period": { "from": "<ISO-8601 datetime>", "to": "<ISO-8601 datetime>" },
    "currency": "<ISO currency code>",
    "ordersByStatus": {
      "pending_payment": "<number>",
      "pending_proof_approval": "<number>",
      "artwork_rejected": "<number>",
      "in_printing": "<number>",
      "ready": "<number>",
      "shipped": "<number>",
      "completed": "<number>",
      "cancelled": "<number>"
    },
    "newOrdersInRange": "<number>",
    "jobsInPrinting": "<number>",
    "jobsReady": "<number>",
    "artworkAwaitingReview": "<number>",
    "pendingPayment": "<number>",
    "unreadMessages": "<number>",
    "pendingReviews": "<number>",
    "lowStockProducts": "<number>",
    "outOfStockProducts": "<number>",
    "revenueInRange": {
      "revenueMinor": "<number>",
      "paidOrderCount": "<number>",
      "averageOrderValueMinor": "<number or null>",
      "previousPeriodRevenueMinor": "<number>",
      "comparisonPercent": "<number or null>"
    },
    "dailySeries": [
      {
        "date": "<YYYY-MM-DD>",
        "orders": "<number>",
        "revenueMinor": "<number>"
      }
    ],
    "topProducts": [
      {
        "productId": "<ObjectId>",
        "title": "<string>",
        "unitsSold": "<number>"
      }
    ],
    "recentOrders": [
      {
        "orderNumber": "<string>",
        "status": "<order status>",
        "totalMinor": "<number>",
        "currency": "<ISO currency code>",
        "createdAt": "<ISO-8601 datetime>"
      }
    ],
    "printQueue": [
      {
        "orderNumber": "<string>",
        "status": "in_printing|ready",
        "createdAt": "<ISO-8601 datetime>",
        "productTitle": "<string>",
        "selectedOptions": [],
        "printTechniques": [],
        "quantity": "<number>",
        "artworkId": "<ObjectId or null>",
        "artworkReviewStatus": "<review status or null>",
        "itemPrintStatus": "<print status>"
      }
    ]
  }
}
```

`GET /api/admin/analytics/sales` requires `from`, `to`, and optional
`groupBy=day|week|month`; it returns a revenue/order-count/AOV series and
revenue by category. Category revenue is merchandise revenue after
proportionally allocating order discounts and refunds; shipping and tax are
not assigned to product categories. `GET /api/admin/analytics/products`
returns top sellers, active least sellers (including zero-sale products), low
stock, and most viewed products. `GET /api/admin/analytics/customers` returns
new customers per bucket, repeat-customer rate, and top customers by spend;
names/emails are null unless the caller has `customers:read`.
`GET /api/admin/analytics/production` returns counts by item print status and
product technique and average payment-to-ready hours for completed jobs, or
`null` when no completed jobs have valid timing data.

`GET /api/admin/notifications` returns:

```json
{
  "success": true,
  "data": {
    "counts": {
      "paid_order_awaiting_proof": "<number>",
      "artwork_awaiting_review": "<number>",
      "new_message": "<number>",
      "pending_review": "<number>",
      "low_stock": "<number>"
    },
    "items": [
      {
        "type": "paid_order_awaiting_proof",
        "label": "Paid orders awaiting proof",
        "count": "<number>",
        "route": "/admin/orders?tab=pending_proof_approval",
        "latest": [
          {
            "orderNumber": "<string>",
            "status": "<string>",
            "createdAt": "<ISO-8601 datetime>"
          }
        ]
      },
      {
        "type": "artwork_awaiting_review",
        "label": "Artwork awaiting review",
        "count": "<number>",
        "route": "/admin/artwork?reviewStatus=pending",
        "latest": [
          {
            "id": "<ObjectId>",
            "filename": "<string>",
            "orderNumber": "<string>",
            "createdAt": "<ISO-8601 datetime>"
          }
        ]
      },
      {
        "type": "new_message",
        "label": "New contact messages",
        "count": "<number>",
        "route": "/admin/messages?status=new",
        "latest": [
          {
            "id": "<ObjectId>",
            "name": "<string>",
            "email": "<string>",
            "subject": "<string>",
            "createdAt": "<ISO-8601 datetime>"
          }
        ]
      },
      {
        "type": "pending_review",
        "label": "Reviews awaiting moderation",
        "count": "<number>",
        "route": "/admin/reviews?moderationState=pending",
        "latest": [
          {
            "id": "<ObjectId>",
            "product": "<product or null>",
            "rating": "<number>",
            "title": "<string>",
            "createdAt": "<ISO-8601 datetime>"
          }
        ]
      },
      {
        "type": "low_stock",
        "label": "Products with low stock",
        "count": "<number>",
        "route": "/admin/products?stockState=low",
        "latest": [
          {
            "id": "<ObjectId>",
            "title": "<string>",
            "sku": "<string>",
            "quantity": "<number>",
            "lowStockThreshold": "<number>"
          }
        ]
      }
    ]
  }
}
```

Each `latest` array contains at most five records. `GET /api/admin/search?q=...`
requires at least two characters, is rate limited, and includes only groups
allowed by the signed-in staff member's permissions. Each group is omitted if
the caller lacks its permission and contains at most five matches:

```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "orderNumber": "<string>",
        "status": "<string>",
        "totalMinor": "<number>",
        "currency": "<ISO currency code>",
        "customerName": "<string>",
        "email": "<string>",
        "createdAt": "<ISO-8601 datetime>"
      }
    ],
    "products": [
      {
        "id": "<ObjectId>",
        "title": "<string>",
        "sku": "<string>",
        "slug": "<string>",
        "status": "<string>"
      }
    ],
    "customers": [
      { "id": "<ObjectId>", "name": "<string>", "email": "<string>" }
    ],
    "messages": [
      {
        "id": "<ObjectId>",
        "name": "<string>",
        "email": "<string>",
        "subject": "<string>",
        "status": "<string>",
        "createdAt": "<ISO-8601 datetime>"
      }
    ]
  }
}
```

`GET /api/admin/search?q=...` requires at least two characters, is rate limited,
and returns at most five matches per permitted group: orders, products,
customers, and messages.

### Staff, audit, FAQs, and newsletter

Staff endpoints never accept or return passwords. Creating staff provisions a
random unusable password, creates a single-use password-reset link using the
existing reset-token mechanism, and emails it through the configured Mailer.
An admin cannot suspend or demote themselves; a database-backed conditional
counter prevents concurrent changes from removing the last active admin. Role
changes and suspensions increment `tokenVersion`.

The audit viewer is paginated and supports `actor`, `action`, `targetType`,
`from`, and `to` filters. Audit records remain append-only. FAQs are not seeded;
public output includes published entries grouped by category, while admins
manage all FAQ records through the settings permission. Newsletter requests
require `{ "email", "consent": true, "source" }` and return the same generic
success message for existing and new addresses. An unsubscribe token is
stored hashed, and a fresh subscription rotates the token. Set `API_PUBLIC_URL`
in the environment to the public Express origin used in unsubscribe links.

## Stripe payments and business profile

The default provider is `manual`. For a local test-mode setup, obtain a Stripe
test secret key and matching test publishable key from Stripe, and set
`PAYMENT_PROVIDER=stripe` in the local `.env`. Set `STRIPE_WEBHOOK_SECRET` to a
test webhook signing secret; for local webhook forwarding, this can be provided
by the Stripe CLI listener configured to forward to
`http://localhost:<PORT>/api/webhooks/stripe`. Keep these values only in the
ignored local `.env`; never paste them into chat or commit them. Do not replace
existing live credentials to test this flow. The server requires all three
Stripe values when Stripe is selected, validates their key formats and checks
that the secret and publishable keys use the same test/live mode. Non-production
environments reject live-mode keys by default. For an explicitly requested
local live checkout, set `PAYMENT_PROVIDER=stripe` and
`ALLOW_LIVE_STRIPE_IN_DEVELOPMENT=true` only in the backend process environment.
This opt-in is accepted only with `NODE_ENV=development`; it does not change
production live-key validation. Because live Checkout Sessions can result in
real charges, enable this only when you intend to use Stripe live mode. The
server cannot verify that the webhook secret belongs to the intended Stripe
account or environment until a signed webhook is received.

To keep existing local credentials unchanged, copy
`.env.stripe-test.example` to `.env.stripe-test`, fill in only your Stripe
test-mode values, then start the backend from PowerShell with:

```powershell
$env:DOTENV_CONFIG_PATH = '.env.stripe-test'
npm run dev
```

The selected override file takes precedence over inherited environment values
and `.env`; missing settings fall back to `.env`. The example placeholders are
rejected at startup until replaced with real test credentials. Stop the backend
with Ctrl+C and run `Remove-Item Env:DOTENV_CONFIG_PATH` in that PowerShell
window before starting the backend without the test override.

The public publishable key is exposed through public settings only when Stripe
is selected. Stripe secret and webhook keys are never included in API responses
or logs. Stripe Checkout is hosted by Stripe; this API never receives or stores
card data. Amounts are derived from persisted order snapshots and sent in the
order's currency, lowercase (for example, `gbp`).

The Stripe flow is:

1. The normal cart checkout creates a pending-payment order and reserves stock.
2. The owner calls `POST /api/orders/:orderNumber/pay`, which creates or
   resumes an expiring hosted Checkout Session and returns its URL.
3. The browser redirects to Stripe Checkout. Success/cancel URLs return to the
   frontend with the order number.
4. Stripe sends signed webhook events to `/api/webhooks/stripe`. A successful
   payment is applied by the shared order workflow, recorded once, and moves
   the order to proof approval or printing.
5. The success page can call `POST /api/orders/:orderNumber/payment/confirm`
   to reconcile a paid session if the webhook is delayed. The separate
   payment-status endpoint reports only persisted state.

Set these environment variables in addition to the normal API configuration:

| Variable                         | Use                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `PAYMENT_PROVIDER`               | `manual` (default) or `stripe`                                               |
| `STRIPE_SECRET_KEY`              | Stripe API key; required and must match the publishable key's test/live mode |
| `STRIPE_WEBHOOK_SECRET`          | Signing secret for webhook verification; required when Stripe is selected    |
| `STRIPE_PUBLISHABLE_KEY`         | Matching test/live public key; required and returned by public settings      |
| `STRIPE_CHECKOUT_EXPIRY_MINUTES` | Checkout session duration; default 30, range 30-1440 minutes                 |
| `UNPAID_ORDER_EXPIRY_HOURS`      | Unpaid-order cancellation age; default 48 hours                              |
| `DEFAULT_CURRENCY`               | Must be `GBP`; defaults to `GBP`                                             |

Stripe errors returned to clients use `PAYMENT_PROVIDER_ERROR` with HTTP 502.
Server logs include only the Stripe request id, not secrets, card details,
customer details, or request payloads. Admin refunds for Stripe-paid orders
call Stripe first and are recorded locally only after Stripe accepts them;
manual-provider refunds remain record-only. Dashboard-created Stripe refunds
are reconciled from `charge.refunded`.

### Payment endpoints

| Endpoint                                        | Access                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /api/orders/:orderNumber/pay`             | Guest session plus optional auth; owner or guest order email; rate limited               |
| `POST /api/orders/:orderNumber/payment/confirm` | Guest session plus optional auth; same owner/email checks; rate limited                  |
| `GET /api/orders/:orderNumber/payment-status`   | Guest session plus optional auth; guest supplies `email` query; rate limited             |
| `POST /api/webhooks/stripe`                     | Public Stripe webhook; signature required; excluded from CORS, CSRF, and API rate limit  |
| `POST /api/admin/orders/:id/payment`            | `orders:update_status`; uses the shared payment application workflow                     |
| `POST /api/admin/orders/:id/refund`             | Admin; `orders:refund`; provider refund is issued for Stripe orders                      |
| `GET /api/admin/orders/:id`                     | `orders:read`; includes provider, payment status, and read-only Stripe payment-intent id |

The guest email is sent as `email` in the body to `/pay` and
`/payment/confirm`, and as the `email` query parameter to
`/payment-status`. Guest order mismatches use a generic access error for
existing and nonexistent orders. `/pay` is valid only while the order is
`pending_payment` and payment is pending or failed. An existing unexpired open
session is returned rather than replaced.

`POST /api/orders/:orderNumber/pay` response:

```json
{
  "success": true,
  "data": {
    "checkoutUrl": "<Stripe hosted Checkout URL>",
    "expiresAt": "<ISO-8601 datetime>"
  }
}
```

`POST /api/orders/:orderNumber/payment/confirm` response is
`{ "success": true, "data": { "status": "pending|failed|paid" } }`.
`GET /api/orders/:orderNumber/payment-status` response is
`{ "success": true, "data": { "status": "<payment status>", "orderStatus": "<order status>" } }`.
The webhook returns HTTP 200 with `{ "received": true }` after successful
processing (including unhandled event types); invalid signatures return HTTP
400 with the standard error envelope. Processing failures return HTTP 500 so
Stripe retries. Successful Stripe events are deduplicated by event id and
retained for 30 days.

### Webhook setup

For local development, install and authenticate the Stripe CLI, then run:

```sh
stripe listen --forward-to localhost:<PORT>/api/webhooks/stripe
```

The CLI prints a `whsec_...` signing secret; set that value as
`STRIPE_WEBHOOK_SECRET` in the local environment. Do not commit it.

In the Stripe Dashboard, add the production endpoint
`https://<your-api-host>/api/webhooks/stripe` and subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.payment_failed`
- `charge.refunded`

Copy the endpoint signing secret into the production
`STRIPE_WEBHOOK_SECRET` variable. The webhook route accepts raw JSON only for
signature verification and is mounted before JSON parsing, CORS, CSRF, and
general rate limiting.

### Unpaid orders and business profile

In production, the existing per-process scheduled maintenance timer runs
unattached-upload cleanup and unpaid-order expiry hourly. Expiry cancels only
unpaid `pending_payment` orders past `UNPAID_ORDER_EXPIRY_HOURS`, attempts to
expire an open Stripe Checkout Session, restores reserved stock, appends
history/audit records, and emails the customer. Run a one-off expiry with
`npm run expire:unpaid`.

`npm run settings:profile` fills only empty business-profile fields with the
configured Dainty Bloom profile (GBP/GB, the provided contact channels,
Coventry studio details, opening hours, social links, and about note). It
refuses to run in production unless invoked as
`npm run settings:profile -- --force`. Settings remain editable through
`PATCH /api/admin/settings`; those changes are audited.

`GET /api/settings/public` returns:

```json
{
  "success": true,
  "data": {
    "storeName": "Dainty Bloom",
    "currency": "GBP",
    "country": "GB",
    "announcementBar": { "enabled": false, "text": "" },
    "turnaroundMessage": "",
    "contact": {
      "email": "info@daintybloome.com",
      "phone": "+44 7417 575436",
      "address": "Custom printing studio, Coventry, United Kingdom",
      "openingHours": ["Mon-Sat, 8:00am - 7:00pm"]
    },
    "guestCheckoutEnabled": false,
    "shippingConfigured": false,
    "socialLinks": {
      "instagram": "https://www.instagram.com/davril_forme",
      "tiktok": "https://www.tiktok.com/@atelier_davril",
      "whatsapp": "https://wa.me/447417575436"
    },
    "contactEmail": "info@daintybloome.com",
    "contactPhone": "+44 7417 575436",
    "whatsappNumber": "+44 7417 575436",
    "studioAddress": {
      "label": "Custom printing studio",
      "city": "Coventry",
      "country": "United Kingdom"
    },
    "openingHours": [
      {
        "days": [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday"
        ],
        "open": "08:00",
        "close": "19:00",
        "timezone": "Europe/London"
      }
    ],
    "openingHoursDisplayText": "Mon-Sat, 8:00am - 7:00pm",
    "aboutNote": "UK-based custom printing studio in Coventry. We make 3D printed goods, paint-it-yourself canvas prints, mugs and T-shirts, and we use an eco-friendly 3D printer for 3D goods.",
    "productLines": [
      {
        "key": "three_d_printed",
        "label": "3D Printed Goods",
        "description": "Made-to-order 3D printed goods such as toys, decorations, lamps and other items, with material, colour and size options.",
        "isActive": true
      },
      {
        "key": "canvas_paint_yourself",
        "label": "Paint-It-Yourself Canvas",
        "description": "Studio-designed canvas prints for customers to paint themselves; customer artwork is not required.",
        "isActive": true
      },
      {
        "key": "mug",
        "label": "Mugs",
        "description": "Mugs with customer artwork upload and print options.",
        "isActive": true
      },
      {
        "key": "tshirt",
        "label": "T-Shirts",
        "description": "T-shirts with customer artwork upload and print options.",
        "isActive": true
      }
    ],
    "stripePublishableKey": "<publishable key when Stripe is selected, otherwise null>"
  }
}
```

The public Stripe key field is `null` for the manual payment provider. The
profile values shown above are applied to an existing database only by running
the profile script; the script does not overwrite non-empty fields.

The default categories are T-Shirts, Mugs, Paint-It-Yourself Canvas, 3D Printed
Goods and its Toys, Home Decor, Lamps and Lighting, and Other 3D Prints child
categories. `categories:sync` never deletes categories; pass
`--deactivate-unused` only when intentionally deactivating the named legacy
categories that have no products.

## Operational readiness

- `GET /api/health` is liveness; `GET /api/health/ready` is public readiness
  and checks the MongoDB connection without returning connection details.
- `express.raw()` is mounted only on the Stripe webhook before JSON parsing.
  The webhook is exempt from CORS, CSRF, and the general rate limiter; webhook
  signatures remain mandatory.
- Credentialed CORS accepts only `CLIENT_URL`. All state-changing `/api`
  requests require `X-Requested-With: dainty-bloom` except the signed webhook.
  The global API rate limiter also covers public writes.
- Private uploads are not served as static/public files. `.gitignore` excludes
  environment files, build output, dependencies, storage, and uploads.
- Mongoose schema indexes are synchronized by `npm run db:sync-indexes`.
- Regenerate and review the complete method/path/protection inventory with
  `npm run routes:list`; see [`docs/api-routes.md`](./docs/api-routes.md).
