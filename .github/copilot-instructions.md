# Dainty Bloom - Custom Printing E-Commerce Platform

## Overview
Dainty Bloom is a full-stack custom printing store selling 3D printed goods, paint-it-yourself canvas prints, mugs, and T-shirts. It has a public customer storefront and a role-protected admin/print-management portal.

## Product lines
- 3D printed goods of any kind, including toys, decorations, lamps, and other made-to-order items. Options may include material, colour, and size.
- Paint-it-yourself canvas prints are designed by the studio and printed on canvas for customers to paint themselves. They do not require customer artwork (`artworkRequired: false`).
- Mugs and T-shirts may support customer artwork uploads and print options.

## Monorepo layout
- /server  -> Node.js + Express.js + TypeScript REST API, MongoDB + Mongoose
- /web     -> Next.js (App Router) + React + TypeScript frontend

## Hard rules
1. Next.js and Express stay separate. ALL business logic lives in Express services. Never duplicate it in Next.js.
2. Never trust client-submitted prices, totals or stock. The server recalculates everything before creating an order.
3. Authorization is enforced in the API for every protected route. Frontend route guards are only a convenience.
4. Server structure: routes -> controllers -> services -> models, plus middleware and validation (use Zod). One centralized error handler with a consistent response format: { success, data } or { success: false, error: { code, message, details } }.
5. Secrets only in environment variables. Provide .env.example. Never commit .env.
6. Customer artwork uploads are private: restrict size and type (verify real file type, not just extension/MIME from the client), never expose public file URLs, use access-controlled or time-limited download links.
7. Never store raw card data. Payment provider is undecided: build a payment abstraction with a stub.
8. Do not invent business claims, fake statistics, fake partner logos or fake integrations. Use configurable settings and clearly marked placeholders.
9. Use TypeScript strictly (no "any"), ESLint + Prettier, and write tests for critical paths (access control, cart validation, order creation, upload validation, status transitions).
10. Roles: customer, admin, and future-ready for staff roles (e.g. production, support) via role-based access control.

## Design system (storefront AND admin share it)
Soft pastel palette, defined once as design tokens and reused everywhere:
- Primary (lavender): #9D8DF1, lighter #B1A2F3, tint #EEEAFE
- Success (mint): #A8E6CF, tint #E9F8F1
- Promotion/warning (peach): #FFD3B6, accent #FFABAB, tint #FFF0E7
- Page background: #F9F8F6 (alt #F4F6F8)
- Surface: #FFFFFF
- Text/borders: slate #6C757D, border #E2E8F0, ink #30313B, deep purple #4D466D
Rounded corners, generous spacing, white cards on cream canvas. Status is always shown with text or icon, not color alone. Meet WCAG 2.2 AA contrast and visible keyboard focus.

## Code quality
Small focused files, clear naming, JSDoc on services, no unused code, handle loading/empty/error/success states on every UI view.
