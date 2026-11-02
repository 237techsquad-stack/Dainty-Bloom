'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
} from 'react';
import {
  Heart,
  Menu,
  Search,
  ShoppingBag,
  UserRound,
  X,
  ChevronDown,
  Package,
} from 'lucide-react';
import type { SiteSettings } from '@/lib/api/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { Brand } from '@/components/layout/Brand';
import { SearchOverlay } from '@/components/layout/SearchOverlay';
import { useCartSummary } from '@/hooks/useCartSummary';
import { Button, Modal, useToast } from '@/components/ui';
import { formatMoney } from '@/lib/utils/formatMoney';

interface HeaderProps {
  settings: SiteSettings | null;
}

const categoryLinks = [
  { label: 'T-Shirts', href: '/category/t-shirts' },
  { label: 'Mugs', href: '/category/mugs' },
  { label: 'Hoodies', href: '/category/hoodies' },
  { label: 'Phone Cases', href: '/category/phone-cases' },
  { label: 'Themes', href: '/themes' },
  { label: 'Toys', href: '/category/toys' },
  { label: 'Home Decor', href: '/category/home-decor' },
  { label: 'Lamps & Lighting', href: '/category/lamps-and-lighting' },
] as const;

function subscribeAnnouncementDismissal(callback: () => void) {
  window.addEventListener('announcement-dismissed', callback);
  return () => window.removeEventListener('announcement-dismissed', callback);
}

function isAnnouncementDismissed() {
  return sessionStorage.getItem('announcement-dismissed') === 'true';
}

function getServerAnnouncementDismissal() {
  return false;
}

export function Header({ settings }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const { user, logout } = useAuth();
  const cart = useCartSummary();
  const announcementDismissed = useSyncExternalStore(
    subscribeAnnouncementDismissal,
    isAnnouncementDismissed,
    getServerAnnouncementDismissal,
  );
  const [openPanel, setOpenPanel] = useState({
    pathname: '',
    menu: false,
    account: false,
    cart: false,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const cartButtonRef = useRef<HTMLButtonElement>(null);
  const cartWrapRef = useRef<HTMLDivElement>(null);
  const categoriesMenuRef = useRef<HTMLDivElement>(null);
  const categoriesButtonRef = useRef<HTMLButtonElement>(null);
  const [categoriesState, setCategoriesState] = useState({
    pathname: '',
    open: false,
  });
  const categoriesOpen =
    categoriesState.pathname === pathname && categoriesState.open;
  const closeCategories = useCallback(
    () => setCategoriesState({ pathname, open: false }),
    [pathname],
  );
  const panelMatchesPath = openPanel.pathname === pathname;
  const menuOpen = panelMatchesPath && openPanel.menu;
  const accountOpen = panelMatchesPath && openPanel.account;
  const cartOpen = panelMatchesPath && openPanel.cart;
  const announcement = settings?.announcementBar;
  const showAnnouncement = Boolean(announcement?.enabled && announcement.text);
  const announcementVisible = showAnnouncement && !announcementDismissed;
  const drawerAddress = settings?.studioAddress
    ? [
        settings.studioAddress.label,
        settings.studioAddress.city,
        settings.studioAddress.country,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const updatePanel = useCallback(
    (panel: 'menu' | 'account' | 'cart', open: boolean) => {
      setOpenPanel((current) => {
        if (open) {
          return {
            pathname,
            menu: panel === 'menu',
            account: panel === 'account',
            cart: panel === 'cart',
          };
        }
        const next = { ...current, pathname };
        if (panel === 'menu') next.menu = open;
        if (panel === 'account') next.account = open;
        if (panel === 'cart') next.cart = open;
        return next;
      });
    },
    [pathname],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchButtonRef.current?.focus());
  }, []);
  const closeMenu = useCallback(
    () => updatePanel('menu', false),
    [updatePanel],
  );

  useEffect(() => {
    if (!categoriesOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !categoriesMenuRef.current?.contains(event.target)
      ) {
        closeCategories();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeCategories();
      categoriesButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [categoriesOpen, closeCategories]);

  useEffect(() => {
    const updateScroll = () => setScrolled(window.scrollY > 4);
    updateScroll();
    window.addEventListener('scroll', updateScroll, { passive: true });
    return () => window.removeEventListener('scroll', updateScroll);
  }, []);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      const key = event.key;
      if (typeof key !== 'string') return;
      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (
        key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isTypingTarget
      ) {
        event.preventDefault();
        setSearchOpen(true);
      } else if (
        key.toLowerCase() === 'k' &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, []);

  useEffect(() => {
    const openCart = () => updatePanel('cart', true);
    window.addEventListener('cart:open', openCart);
    return () => window.removeEventListener('cart:open', openCart);
  }, [updatePanel]);

  useEffect(() => {
    if (!cartOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !cartWrapRef.current?.contains(event.target)
      ) {
        updatePanel('cart', false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cartButtonRef.current?.focus();
      updatePanel('cart', false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [cartOpen, updatePanel]);

  const hideAnnouncement = () => {
    sessionStorage.setItem('announcement-dismissed', 'true');
    window.dispatchEvent(new Event('announcement-dismissed'));
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      toast('Your session could not be confirmed as signed out.', 'error');
    }
    updatePanel('account', false);
    router.push('/');
  };

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {announcementVisible ? (
        <div className="announcement-bar">
          <p>
            {announcement?.text}
            {settings?.turnaroundMessage
              ? ` · ${settings.turnaroundMessage}`
              : ''}
          </p>
          <button aria-label="Dismiss announcement" onClick={hideAnnouncement}>
            <X size={17} />
          </button>
        </div>
      ) : null}
      <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="header-main container">
          <button
            className="icon-button mobile-menu-trigger"
            aria-label="Open menu"
            title="Open menu"
            aria-expanded={menuOpen}
            onClick={() => updatePanel('menu', true)}
          >
            <Menu aria-hidden="true" />
          </button>
          <Brand />
          <nav className="primary-navigation" aria-label="Primary navigation">
            <Link className={pathname === '/' ? 'is-active' : ''} href="/">
              Home
            </Link>
            <Link
              className={pathname.startsWith('/shop') ? 'is-active' : ''}
              href="/shop"
            >
              Shop
            </Link>
            <div
              className={`shop-dropdown${categoriesOpen ? ' is-open' : ''}${pathname.startsWith('/category/') || pathname === '/themes' ? ' is-active' : ''}`}
              ref={categoriesMenuRef}
            >
              <button
                ref={categoriesButtonRef}
                type="button"
                aria-haspopup="true"
                aria-expanded={categoriesOpen}
                title="Browse categories"
                onClick={() =>
                  setCategoriesState({ pathname, open: !categoriesOpen })
                }
              >
                Categories <ChevronDown size={14} aria-hidden="true" />
              </button>
              {categoriesOpen ? (
                <div
                  className="shop-dropdown__menu"
                  role="menu"
                  onKeyDown={(event) => {
                    const items = Array.from(
                      event.currentTarget.querySelectorAll<HTMLAnchorElement>(
                        '[role="menuitem"]',
                      ),
                    );
                    const currentIndex = items.indexOf(
                      document.activeElement as HTMLAnchorElement,
                    );
                    let nextIndex: number | null = null;
                    if (event.key === 'ArrowDown') {
                      nextIndex = (currentIndex + 1) % items.length;
                    } else if (event.key === 'ArrowUp') {
                      nextIndex =
                        (currentIndex - 1 + items.length) % items.length;
                    } else if (event.key === 'Home') {
                      nextIndex = 0;
                    } else if (event.key === 'End') {
                      nextIndex = items.length - 1;
                    }
                    if (nextIndex !== null && items[nextIndex]) {
                      event.preventDefault();
                      items[nextIndex].focus();
                    }
                  }}
                >
                  {categoryLinks.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      role="menuitem"
                      className={pathname === href ? 'is-active' : ''}
                      onClick={closeCategories}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <Link
              className={
                pathname === '/category/3d-printed-goods' ? 'is-active' : ''
              }
              href="/category/3d-printed-goods"
            >
              3D Prints
            </Link>
            <Link
              className={
                pathname === '/category/paint-it-yourself-canvas'
                  ? 'is-active'
                  : ''
              }
              href="/category/paint-it-yourself-canvas"
            >
              Paint-It-Yourself Canvas
            </Link>
            <Link
              className={pathname === '/about' ? 'is-active' : ''}
              href="/about"
            >
              About Us
            </Link>
            <Link
              className={pathname === '/contact' ? 'is-active' : ''}
              href="/contact"
            >
              Contact Us
            </Link>
          </nav>
          <div className="header-actions">
            <button
              ref={searchButtonRef}
              className="icon-button search-trigger"
              aria-label="Search"
              title="Search"
              onClick={() => setSearchOpen(true)}
            >
              <Search aria-hidden="true" />
            </button>
            <div
              className="account-wrap"
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  updatePanel('account', false);
                }
              }}
            >
              <button
                className="icon-button account-button"
                aria-label={user ? 'Account menu' : 'Sign in'}
                title={user ? 'Account menu' : 'Sign in'}
                aria-expanded={accountOpen}
                onClick={() =>
                  user
                    ? updatePanel('account', !accountOpen)
                    : router.push('/login')
                }
              >
                <UserRound aria-hidden="true" />
              </button>
              {accountOpen && user ? (
                <nav className="account-popover" aria-label="Account">
                  <p className="account-name">{user.name}</p>
                  {user.role === 'customer' ? (
                    <Link href="/account/profile">
                      <UserRound size={17} /> My profile
                    </Link>
                  ) : null}
                  <Link href="/account/orders">
                    <Package size={17} /> My orders
                  </Link>
                  {user.role === 'customer' ? (
                    <Link href="/account/custom-requests">
                      <Package size={17} /> My custom requests
                    </Link>
                  ) : null}
                  {user.role !== 'customer' ? (
                    <Link href="/admin">
                      <Package size={17} /> Admin dashboard
                    </Link>
                  ) : null}
                  <button onClick={() => void handleLogout()}>Sign out</button>
                </nav>
              ) : null}
            </div>
            <Link
              className="icon-button action-link wishlist-action"
              href="/wishlist"
              aria-label={`Wishlist${cart.data ? `, ${cart.data.wishlistCount} items` : ''}`}
              title="Wishlist"
            >
              <Heart aria-hidden="true" />
              {cart.data?.wishlistCount ? (
                <span className="count-badge">{cart.data.wishlistCount}</span>
              ) : null}
            </Link>
            <div
              ref={cartWrapRef}
              className="cart-wrap"
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') updatePanel('cart', true);
              }}
              onPointerLeave={(event) => {
                if (
                  event.pointerType === 'mouse' &&
                  !cartWrapRef.current?.contains(document.activeElement)
                ) {
                  updatePanel('cart', false);
                }
              }}
              onFocus={() => updatePanel('cart', true)}
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  ) &&
                  !event.currentTarget.matches(':hover')
                )
                  updatePanel('cart', false);
              }}
            >
              <button
                ref={cartButtonRef}
                className="icon-button cart-button"
                aria-label={`Cart${cart.data ? `, ${cart.data.itemCount} items` : ''}`}
                title="Cart"
                aria-expanded={cartOpen}
                aria-controls="header-cart-summary"
                onClick={() => updatePanel('cart', true)}
              >
                <ShoppingBag aria-hidden="true" />
                {cart.data?.itemCount ? (
                  <span className="count-badge">{cart.data.itemCount}</span>
                ) : null}
              </button>
              {cartOpen ? (
                <div
                  id="header-cart-summary"
                  className="mini-cart"
                  role="region"
                  aria-label="Cart summary"
                >
                  {cart.isPending ? (
                    <p>Loading cart summary…</p>
                  ) : cart.data ? (
                    <>
                      <p>
                        <strong>{cart.data.itemCount}</strong>{' '}
                        {cart.data.itemCount === 1 ? 'item' : 'items'} in your
                        cart
                      </p>
                      <p>
                        Subtotal{' '}
                        <strong>
                          {formatMoney(
                            cart.data.subtotalMinor,
                            cart.data.currency,
                          )}
                        </strong>
                      </p>
                    </>
                  ) : (
                    <p>Your cart summary is unavailable right now.</p>
                  )}
                  <div className="mini-cart__actions">
                    <Button
                      variant="secondary"
                      onClick={() => router.push('/cart')}
                    >
                      View cart
                    </Button>
                    <Button onClick={() => router.push('/checkout')}>
                      Checkout
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <Modal open={menuOpen} onClose={closeMenu} title="Browse Dainty Bloom">
        <div className="mobile-drawer-content">
          <nav aria-label="Mobile navigation">
            <Link href="/" onClick={closeMenu}>
              Home
            </Link>
            <Link href="/shop" onClick={closeMenu}>
              Shop
            </Link>
            <div
              className="mobile-nav-categories"
              role="group"
              aria-label="Categories"
            >
              <p className="mobile-nav-categories__title">Categories</p>
              {categoryLinks.map(({ href, label }) => (
                <Link key={href} href={href} onClick={closeMenu}>
                  {label}
                </Link>
              ))}
            </div>
            <Link href="/category/3d-printed-goods" onClick={closeMenu}>
              3D Prints
            </Link>
            <Link href="/category/paint-it-yourself-canvas" onClick={closeMenu}>
              Paint-It-Yourself Canvas
            </Link>
            <Link href="/about" onClick={closeMenu}>
              About Us
            </Link>
            <Link href="/contact" onClick={closeMenu}>
              Contact Us
            </Link>
          </nav>
          {user ? (
            <div className="mobile-account-links">
              {user.role === 'customer' ? (
                <Link href="/account/profile" onClick={closeMenu}>
                  My profile
                </Link>
              ) : null}
              <Link href="/account/orders" onClick={closeMenu}>
                My orders
              </Link>
              {user.role === 'customer' ? (
                <Link href="/account/custom-requests" onClick={closeMenu}>
                  My custom requests
                </Link>
              ) : null}
              {user.role !== 'customer' ? (
                <Link href="/admin" onClick={closeMenu}>
                  Admin dashboard
                </Link>
              ) : null}
              <button onClick={() => void handleLogout()}>Sign out</button>
            </div>
          ) : (
            <Link href="/login" onClick={closeMenu}>
              Sign in
            </Link>
          )}
          <div className="drawer-contact">
            {settings?.contactEmail ? (
              <a href={`mailto:${settings.contactEmail}`}>
                {settings.contactEmail}
              </a>
            ) : null}
            {settings?.contactPhone ? (
              <a href={`tel:${settings.contactPhone}`}>
                {settings.contactPhone}
              </a>
            ) : null}
            {settings?.whatsappNumber ? (
              <a
                href={`https://wa.me/${settings.whatsappNumber.replace(/\D/g, '')}`}
              >
                WhatsApp
              </a>
            ) : null}
            {drawerAddress ? <p>{drawerAddress}</p> : null}
            {settings?.openingHoursDisplayText ? (
              <p>{settings.openingHoursDisplayText}</p>
            ) : null}
          </div>
        </div>
      </Modal>
      <SearchOverlay open={searchOpen} onClose={closeSearch} />
    </>
  );
}
