'use client';

import { Suspense, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ClipboardCheck,
  PackageCheck,
  PencilRuler,
  Sparkles,
} from 'lucide-react';
import Image from 'next/image';
import { Brand } from '@/components/layout/Brand';
import { CatalogBrowse } from '@/components/catalog/CatalogBrowse';
import {
  ArtworkUpload,
  type Artwork,
  ProductDetailClient,
} from '@/components/catalog/ProductDetailClient';
import {
  EmptyStateCatalog,
  ErrorStateCatalog,
  ProductGrid,
  ProductLineIcon,
  StarRating,
} from '@/components/catalog/CatalogComponents';
import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Input,
  PriceDisplay,
  QuantityStepper,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
} from '@/components/ui';
import type { CatalogCard, CatalogPage, Category, PublicProduct } from '@/lib/api/types';
import type { CartView, CustomerOrder } from '@/lib/api/types';
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge';
import { orderStatusLabel } from '@/components/orders/orderStatus';
import { formatDate } from '@/lib/utils/formatDate';
import { formatMoney } from '@/lib/utils/formatMoney';

interface UiPreviewProps {
  products: CatalogCard[];
  categories: Category[];
  catalog: CatalogPage;
  product: PublicProduct;
  cartLine: CartView['items'][number];
  orderPreview: Pick<CustomerOrder, 'orderNumber' | 'status' | 'statusHistory'>;
}

const previewArtwork: Artwork = {
  id: 'preview-artwork',
  name: 'sample-artwork.png',
  mime: 'image/png',
  sizeBytes: 512_000,
};

export function UiPreview({ products, categories, catalog, product, cartLine, orderPreview }: UiPreviewProps) {
  const [quantity, setQuantity] = useState(2);
  const [activeTab, setActiveTab] = useState('details');
  const [rating, setRating] = useState(4);

  return (
    <main className="ui-preview-page">
      <header className="ui-preview-header container">
        <Brand />
        <div>
          <p className="eyebrow">Development only · sample data</p>
          <h1>Dainty Bloom UI preview</h1>
          <p>Sample props below are for visual review only and are not used by live storefront pages.</p>
        </div>
      </header>

      <section className="home-hero ui-preview-hero">
        <div className="home-hero__inner container">
          <div className="home-hero__copy">
            <span className="eyebrow">Sample home hero</span>
            <h1>Bring your ideas to life</h1>
            <p>Previewing the real storefront hero layout with clearly labelled sample presentation copy.</p>
            <div className="button-row">
              <Button size="lg">Shop now</Button>
              <Button variant="secondary" size="lg">Request a custom 3D print</Button>
            </div>
          </div>
          <div className="home-hero__visual" aria-label="Sample hero visual">
            <div className="home-hero__mark ui-preview-logo-card">
              <span className="ui-preview-decoration ui-preview-decoration--one" />
              <span className="ui-preview-decoration ui-preview-decoration--two" />
              <Brand />
              <Sparkles aria-hidden="true" />
            </div>
          </div>
        </div>
      </section>

      <section className="home-section container ui-preview-section">
        <PreviewHeading title="Product card states" detail="Every card below uses explicit sample props." />
        <ProductGrid products={products} />
      </section>

      <section className="home-section container ui-preview-section">
        <PreviewHeading title="Shop filters and drawer" detail="Real catalog browse component with sample catalog and category props." />
        <Suspense fallback={<p role="status">Loading filter preview…</p>}>
          <CatalogBrowse initialData={catalog} categories={categories} initialQuery={{}} />
        </Suspense>
      </section>

      <section className="home-section container ui-preview-section">
        <PreviewHeading title="Options, quantities, prices and artwork" detail="Real product detail and artwork upload components with sample states." />
        <div className="ui-preview-upload-grid">
          <ArtworkUpload product={product} artwork={null} progress={null} error="" onSelect={() => undefined} onRemove={() => undefined} mimeTypes={['image/png', 'image/jpeg']} maxBytes={5_000_000} />
          <ArtworkUpload product={product} artwork={null} progress={64} error="" onSelect={() => undefined} onRemove={() => undefined} mimeTypes={['image/png', 'image/jpeg']} maxBytes={5_000_000} />
          <ArtworkUpload product={product} artwork={previewArtwork} progress={null} error="" onSelect={() => undefined} onRemove={() => undefined} mimeTypes={['image/png', 'image/jpeg']} maxBytes={5_000_000} />
          <ArtworkUpload product={product} artwork={null} progress={null} error="The sample upload could not be completed." onSelect={() => undefined} onRemove={() => undefined} mimeTypes={['image/png', 'image/jpeg']} maxBytes={5_000_000} />
        </div>
        <div className="ui-preview-control-grid">
          <div className="card ui-preview-control-card">
            <h2>Quantity and price</h2>
            <QuantityStepper value={quantity} min={1} max={20} onChange={setQuantity} />
            <PriceDisplay amountMinor={1200} compareAtMinor={1600} currency="GBP" />
          </div>
          <div className="card ui-preview-control-card">
            <h2>Rating</h2>
            <StarRating rating={4.8} count={12} />
            <StarRating input value={rating} onChange={setRating} />
          </div>
          <div className="card ui-preview-control-card">
            <h2>Badges</h2>
            <div className="ui-preview-inline">
              <Badge>Sample neutral</Badge>
              <Badge tone="success">Sample success</Badge>
              <Badge tone="warning">Sample warning</Badge>
              <StatusBadge status="processing" />
            </div>
          </div>
        </div>
        <ProductDetailClient
          product={product}
          initialSettings={null}
          showReviews={false}
          showStickyBar={false}
        />
      </section>

      <section className="home-section container ui-preview-section">
        <PreviewHeading title="Tabs and accordion" detail="Real shared UI components." />
        <Tabs
          tabs={[{ id: 'details', label: 'Details' }, { id: 'shipping', label: 'Shipping' }, { id: 'care', label: 'Care' }]}
          active={activeTab}
          onChange={setActiveTab}
        />
        <p className="ui-preview-tab-content">Sample content for the {activeTab} tab.</p>
        <Accordion title="Sample accordion">
          <p>Clearly labelled sample accordion content used only by this development preview.</p>
        </Accordion>
      </section>

      <section className="home-section container ui-preview-section">
        <PreviewHeading title="Cart and order components" detail="Clearly labelled sample cart line, price issue, summary, and order timeline props." />
        <div className="cart-layout">
          <article className="commerce-card cart-line">
            <div className="cart-line__image">{cartLine.image ? <Image src={cartLine.image} alt="" fill sizes="104px" /> : null}</div>
            <div className="cart-line__content">
              <div className="cart-line__top"><h2>{cartLine.title}</h2><strong>{formatMoney(cartLine.lineTotalMinor, 'GBP')}</strong></div>
              <ul className="cart-options">{cartLine.selectedOptions.map((option) => <li key={option.key}>{option.label}: {option.valueLabel}</li>)}</ul>
              <div className="cart-line__artwork"><span>{cartLine.artwork?.originalFilename} · Awaiting review</span></div>
              {cartLine.issues.map((issue) => <div className="commerce-alert" role="status" key={issue.code}><AlertCircle size={18} /><p>{issue.message} · Old {formatMoney(issue.oldPriceMinor ?? 0, 'GBP')} · New {formatMoney(issue.newPriceMinor ?? 0, 'GBP')}</p></div>)}
              <div className="cart-line__actions"><QuantityStepper value={cartLine.quantity} min={1} max={99} onChange={() => undefined} /><span className="muted">Sample quantity</span></div>
            </div>
          </article>
          <aside className="commerce-card commerce-summary" aria-label="Sample cart summary">
            <h2>Sample order summary</h2>
            <div className="commerce-row"><span>Subtotal</span><strong>{formatMoney(3700, 'GBP')}</strong></div>
            <div className="commerce-row"><span>Shipping</span><span>Calculated at checkout</span></div>
            <div className="commerce-row commerce-summary__total"><span>Total</span><strong>{formatMoney(3700, 'GBP')}</strong></div>
            <Button>Sample checkout button</Button>
          </aside>
        </div>
        <article className="commerce-card ui-preview-order-timeline">
          <h2>Sample order {orderPreview.orderNumber}</h2>
          <OrderStatusBadge status={orderPreview.status} />
          <ol className="order-timeline">
            {orderPreview.statusHistory.map((entry) => <li className="is-complete" key={`${entry.to}-${entry.at}`}><strong>{orderStatusLabel(entry.to)}</strong><time dateTime={entry.at}>{formatDate(entry.at)}</time></li>)}
          </ol>
        </article>
      </section>

      <section className="home-section container ui-preview-section">
        <PreviewHeading title="Buttons, fields, switches and states" detail="Shared components and form controls." />
        <div className="ui-preview-button-grid">
          {(['primary', 'secondary', 'ghost', 'danger'] as const).flatMap((variant) =>
            (['sm', 'md', 'lg'] as const).map((size) => (
              <Button key={`${variant}-${size}`} variant={variant} size={size}>
                {variant} · {size}
              </Button>
            )),
          )}
        </div>
        <div className="ui-preview-form-grid">
          <Input label="Sample text input" placeholder="Your text" />
          <Select label="Sample select" defaultValue="lavender">
            <option value="lavender">Lavender</option>
            <option value="mint">Mint</option>
          </Select>
          <Input label="Sample number input" type="number" min={1} defaultValue={2} />
          <Input label="Sample file input" type="file" />
          <Textarea label="Sample note" placeholder="A short note" />
          <Checkbox label="Sample checkbox" />
          <label className="ui-preview-radio"><input type="radio" name="preview-radio" defaultChecked /> Sample radio choice</label>
          <label className="ui-switch"><input type="checkbox" role="switch" defaultChecked /><span aria-hidden="true" /> Sample switch</label>
        </div>
        <div className="ui-preview-state-grid">
          <EmptyStateCatalog title="No products here yet">
            Sample empty state with a short supporting message.
          </EmptyStateCatalog>
          <ErrorStateCatalog title="Sample error state" retry={() => undefined} />
        </div>
      </section>

      <section className="home-section container ui-preview-section">
        <PreviewHeading title="Product lines and how it works" detail="Real storefront class structures with sample props." />
        <div className="product-lines-grid">
          {[
            { title: '3D Printed Goods', description: 'Sample line description for made-to-order objects.' },
            { title: 'Paint-It-Yourself Canvas', description: 'Sample line description for creative projects.' },
            { title: 'Mugs', description: 'Sample line description for custom drinkware.' },
            { title: 'T-Shirts', description: 'Sample line description for wearable prints.' },
          ].map((line) => (
            <article className="product-line-card" key={line.title}>
              <span className="product-line-card__icon"><ProductLineIcon value={line.title} /></span>
              <h3>{line.title}</h3>
              <p>{line.description}</p>
              <span className="text-link">Explore <ArrowRight aria-hidden="true" size={16} /></span>
            </article>
          ))}
        </div>
        <div className="custom-request-banner">
          <div><span className="eyebrow">Sample custom 3D banner</span><h2>Have something specific in mind?</h2><p>Tell us what you&apos;d like made and we&apos;ll send you a quote.</p></div>
          <Button>Request a custom 3D print</Button>
        </div>
        <ol className="how-it-works">
          {[
            { label: 'Choose a product', Icon: PackageCheck },
            { label: 'Pick options or upload artwork', Icon: PencilRuler },
            { label: 'We check your proof', Icon: ClipboardCheck },
            { label: 'We make it and send it', Icon: Check },
          ].map(({ label, Icon }, index) => (
            <li key={label}><span className="how-it-works__icon"><Icon aria-hidden="true" /></span><span className="how-it-works__number">0{index + 1}</span><h3>{label}</h3><p>Short sample step description.</p></li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function PreviewHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="section-heading">
      <div><span className="eyebrow">Sample component preview</span><h2>{title}</h2><p>{detail}</p></div>
    </div>
  );
}
