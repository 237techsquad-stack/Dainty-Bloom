# Dainty Bloom storefront

This Next.js App Router application is the customer-facing frontend. Business
rules and persisted data remain in the separate Express API in `../server`.
The storefront does not contain product, category, contact, or other seeded
business data; public settings and categories are loaded from the API.

## Run the API and website

Install dependencies in both folders once:

```powershell
Set-Location "C:\Users\Emma\Documents\Dainty Bloom\server"
npm install
Set-Location "C:\Users\Emma\Documents\Dainty Bloom\web"
npm install
```

Set the API port to `5000` to match the frontend proxy, then start each server
in its own PowerShell terminal:

```powershell
Set-Location "C:\Users\Emma\Documents\Dainty Bloom\server"
$env:PORT = "5000"
npm run dev
```

```powershell
Set-Location "C:\Users\Emma\Documents\Dainty Bloom\web"
npm run dev
```

Next.js runs at `http://localhost:3000`. Browser API calls use the Next.js
`/api/:path*` rewrite, which forwards them to `API_URL` and keeps API cookies
first-party. The Express Stripe webhook remains directly on the API server;
it is not routed through Next.js.

## Environment

Copy `.env.example` to `.env.local` for local frontend overrides:

| Variable               | Purpose                                                      | Default                                |
| ---------------------- | ------------------------------------------------------------ | -------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | Explicit canonical site origin used for metadata and sitemap | Local example: `http://localhost:3000` |
| `API_URL`              | Server-side API base and rewrite destination                 | `http://localhost:5000`                |

Set the Vercel Production `NEXT_PUBLIC_SITE_URL` to
`https://daintybloome.com`. Production indexing and sitemap output are enabled
only when `VERCEL_ENV=production` and this exact HTTPS origin is configured;
all other deployments and origins remain `noindex,nofollow`.

Set `API_URL` to the backend origin only, without a path or `/api` suffix. The
application appends `/api` for server requests and the same-origin rewrite.
Local development defaults to `http://localhost:5000`; Preview and Production
require an explicitly configured `API_URL`. The Render URL is pending. Since
the rewrite is resolved from Next.js configuration, set this value for the
deployment build as well as the server runtime. Do not set `VERCEL_ENV`
manually in Vercel.

The frontend has no secret variables. It reads the Stripe publishable key from
`GET /api/settings/public`; secret Stripe credentials stay in the Express API.
Do not put `.env` or `.env.local` in source control.

The Express API defaults to port `3000` unless `PORT` is set. Set its port to
`5000` (as above), or change the local `API_URL` to the API's configured port.

## Structure

```text
src/
  app/          App Router layouts, storefront pages, and error/loading states
  components/
    admin/      Permission-aware admin shell, dashboard, and shared admin UI
    auth/       Login, registration, and password recovery forms
    layout/     Header, footer, and customer storefront shell
    providers/  React Query, auth, and toast providers
    ui/         Accessible design-system primitives
  hooks/        Settings, category, and cart-summary queries
  lib/
    api/        Browser client, server fetcher, and API response types
    utils/      Shared formatting helpers
  styles/       Global design tokens, Tailwind theme, and responsive styles
```

The storefront home, shop, category, product and wishlist pages use API data.
Product records, prices, images, ratings, FAQs, settings and categories are
never replaced with sample content; unavailable data is shown as an error or
honest empty state.

## Authentication and admin routes

| Route                         | Purpose                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `/login`                      | Customer sign in; all signed-in users continue to `next` or the storefront |
| `/register`                   | Create a customer account and sign in                                      |
| `/forgot-password`            | Request a password reset with a generic response                           |
| `/reset-password?token=...`   | Set a new password using a reset token                                     |
| `/shop`                       | Search, filter, sort and paginate active catalog products                  |
| `/category/[slug]`            | Browse an active category and its active child categories                  |
| `/product/[slug]`             | Configure options, upload artwork, request a server quote and add to cart  |
| `/wishlist`                   | View and remove saved products; guest wishlists use the API session        |
| `/cart`                       | Live-priced cart, issue resolution, artwork attachment, and order summary  |
| `/checkout`                   | Validated customer/guest checkout and server-created order                 |
| `/checkout/success?order=…`   | Payment confirmation and bounded status polling                            |
| `/checkout/cancelled?order=…` | Saved-order payment retry and order details                                |
| `/account/orders`             | Paginated order history for signed-in customers                            |
| `/orders/[orderNumber]`       | Owner-only order details or guest email lookup                             |
| `/track-order`                | Public order-number and email lookup                                       |
| `/admin/login`                | Staff-only sign-in; customer accounts are denied by the API                |
| `/admin`                      | Permission-guarded admin dashboard                                         |
| `/admin/dashboard`            | Dashboard alias                                                            |
| `/admin/products`             | API-backed product search, filters, stock actions and bulk status          |
| `/admin/products/new`         | Create a draft product and configure its catalog details                   |
| `/admin/products/[id]`        | Edit a product and manage its images                                       |
| `/admin/categories`           | API-backed category tree and category management                           |

Authentication and admin pages use a dedicated layout without the storefront
header/footer. Admin pages set `noindex,nofollow`. Middleware checks the
`daintyAccessToken` cookie only as a convenience; Express remains responsible
for authenticating and authorizing every protected API request. The auth
provider exposes API-returned role permissions through `usePermissions()`.

The dashboard fetches `/api/admin/dashboard` with a selected date range and the
browser timezone. Admin search and notifications use `/api/admin/search` and
`/api/admin/notifications`; query states, empty states, and API errors are
rendered explicitly. Only implemented navigation destinations are enabled.
Admin search and notification results for unimplemented pages are shown as
disabled “Coming soon” items.

### Signing in as the seeded admin

1. In a non-production server environment, configure `MONGODB_URI`,
   `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD` in the server environment.
   Choose the email and password yourself; the password is never printed by
   the seed script.
2. From the `server` directory, run `npm run seed`. The script creates the
   admin account only if that email does not already exist.
3. Start the API on port `5000` and the website on port `3000` as described
   above.
4. Open `http://localhost:3000/admin/login` and enter the configured
   `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. The staff portal sends
   `portal: "admin"`; the API validates the role and sets the session cookies.

Product and category lists, settings, and product images come from the API.
The admin product list unwraps `data.items` and `data.pagination`; product
details and mutations unwrap `data.product`; category reads unwrap the API's
flat `data.categories` array and assemble its tree by parent id. Bulk status
returns only an updated count, so the UI does not display fabricated
per-product failure details. Product image changes use the dedicated media
endpoints and their `data.media` response.

The public shop API returns a list `data` object containing `items`,
`pagination`, and `facets`; the frontend preserves that shape for server
rendering and URL-driven filtering. Catalog color facets are value/label/hex
records. Product details unwrap `data.product`; quote results are returned
directly in `data`, and artwork upload returns metadata directly in `data`.
Wishlist responses contain `products`, `count`, and `removedCount`. The public
settings response includes effective artwork upload limits and allowed MIME
types. Product detail includes the configured minimum order quantity and an
effective maximum (the product-specific cap or the server's cart quantity cap).
Category detail unwraps `data.category`.

The storefront uses shared `ProductCard`, `ProductGrid`, `StarRating`,
`AvailabilityBadge`, catalog skeleton/empty/error states, `CatalogBrowse`,
`ProductDetailClient`, `ArtworkUpload`, `ReviewsPanel`, and the optimistic
`useWishlist` hook. Filters and pagination are reflected in the URL. Product
prices for selected options are requested from the Express quote endpoint;
the browser does not calculate option prices.

Never run the seed script in production. If that account already exists, use
its current password or follow the normal password-reset process.

## API data contracts

- Public data uses the API envelope `{ "success": true, "data": ... }`.
- API errors use `{ "success": false, "error": { "code", "message", "details" } }`.
- `GET /api/settings/public` supplies the store's public settings, social and
  contact links, opening-hours display text, product lines, supported
  countries, and nullable `stripePublishableKey`.
- `GET /api/categories` supplies the active category tree. The header, footer,
  and home page display only categories returned by this endpoint.
- `GET /api/cart/summary` returns `itemCount`, `subtotalMinor`, `currency`, and
  `wishlistCount`.
- `GET /api/cart` returns live-priced lines, totals, issues, and a blocking
  issue flag. Artwork filenames and image previews are returned only for files
  owned by the current account or guest session; image previews use the
  access-controlled `/api/artwork/:id/preview` endpoint, not public file URLs.
- `GET /api/checkout/preview` returns validated lines, server-calculated
  subtotal, discount, shipping, tax, total, and issue details.
- `POST /api/orders` accepts `contact`, `shippingAddress`, optional
  `billingAddress`, `billingSameAsShipping`, and optional `customerNote`, plus
  a UUID `Idempotency-Key` header. Express recalculates prices, stock, and
  totals. The response contains the owner-safe order in `data.order`.
- `POST /api/orders/:orderNumber/pay` accepts optional guest `{ email }` and
  returns `data.checkoutUrl` and `data.expiresAt`. Payment confirmation
  returns `data.status`; payment status returns `data.status` and
  `data.orderStatus`.
- `GET /api/orders` returns a paginated `data.items` list for the signed-in
  owner. Guest lookup uses `POST /api/orders/lookup` with
  `{ orderNumber, email }`; lookup returns `data.order`. Guest email is kept
  in `sessionStorage`, not placed in route URLs.
- Order detail includes real status history, current payment status, saved
  address snapshots, shipment details when available, product images, and
  artwork review information. Replacement artwork uses the upload endpoint
  followed by `POST /api/orders/:orderNumber/items/:itemId/artwork`.
- Cart, checkout, payment results, order history/detail, and order lookup are
  `noindex`; the private routes are disallowed in `robots.txt` and are not
  included in the sitemap.
- Search suggestions come from
  `GET /api/products/search-suggestions?q=...`; the frontend waits until the
  query has at least two characters before searching.
- Newsletter opt-in posts `email`, `consent: true`, and `source` to
  `POST /api/newsletter/subscribe`. Success and errors use the API envelope.

See [`../server/README.md`](../server/README.md) and
[`../server/docs/api-routes.md`](../server/docs/api-routes.md) for the complete
API endpoint contracts and access levels.

## Design tokens

The source of truth is `src/styles/globals.css`; the Tailwind theme references
the same CSS variables.

| Token                | Value     |
| -------------------- | --------- |
| Primary lavender     | `#9D8DF1` |
| Light lavender       | `#B1A2F3` |
| Lavender tint        | `#EEEAFE` |
| Success mint         | `#A8E6CF` |
| Mint tint            | `#E9F8F1` |
| Promotion peach      | `#FFD3B6` |
| Peach accent         | `#FFABAB` |
| Peach tint           | `#FFF0E7` |
| Page background      | `#F9F8F6` |
| Alternate background | `#F4F6F8` |
| Surface              | `#FFFFFF` |
| Slate                | `#6C757D` |
| Border               | `#E2E8F0` |
| Ink                  | `#30313B` |
| Deep purple          | `#4D466D` |
| Orchid brand accent  | `#AF86B9` |
| Sage accent          | `#7C9A6B` |

The storefront uses Cormorant Garamond headings and Inter body text through
`next/font`. Focus indicators, text labels for statuses, touch targets, and
reduced-motion behavior are included in the shared design system.

## Scripts

| Script           | Purpose                             |
| ---------------- | ----------------------------------- |
| `npm run dev`    | Start Next.js development server    |
| `npm run build`  | Build the production website        |
| `npm run start`  | Serve the production build          |
| `npm run lint`   | Run ESLint                          |
| `npm run format` | Format frontend files with Prettier |
