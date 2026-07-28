"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Heart,
  Menu,
  Search,
  ShoppingBag,
  User,
  X
} from "lucide-react";
import {
  categories,
  featuredProducts,
  footerColumns,
  navItems,
  promos,
  socialLinks,
  trendingProducts,
  values,
  type CategoryItem,
  type ProductItem
} from "./home.data";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  copy?: string;
  href?: string;
  actionLabel?: string;
}

interface CategoryCardProps {
  category: CategoryItem;
}

interface ProductCardProps {
  product: ProductItem;
  index: number;
}

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0 }
};

function isActiveNavItem(href: string, pathname: string, params: URLSearchParams, index: number) {
  const [targetPath, targetQuery] = href.split("?");

  if (targetQuery) {
    const query = new URLSearchParams(targetQuery);
    return pathname === targetPath && [...query.entries()].every(([key, value]) => params.get(key) === value);
  }

  return pathname === targetPath || (pathname === "/" && index === 0);
}

function HomeNavFallback() {
  return (
    <header className="sticky top-0 z-50 border-b border-black/10 bg-white/90 shadow-[0_14px_34px_rgba(17,16,14,0.08)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-[min(calc(100%-20px),1480px)] items-center justify-between min-[521px]:h-[72px] min-[521px]:w-[min(calc(100%-28px),1480px)] lg:h-[88px] xl:h-28">
        <Link className="font-display text-[31px] font-bold leading-none text-[#080806] min-[521px]:text-4xl xl:text-[54px]" href="/">
          FitLook
        </Link>
        <div className="flex items-center gap-1 xl:gap-5">
          <span className="hidden h-[70px] w-[min(22vw,360px)] min-w-[260px] rounded-pill bg-[#f2edeb] lg:block" aria-hidden="true" />
          <Link className="grid size-11 place-items-center text-[#080806]" href="/login" aria-label="Account">
            <User className="size-[23px]" strokeWidth={1.8} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function HomeNavContent() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentParams = new URLSearchParams(searchParams.toString());

  return (
    <header className="sticky top-0 z-50 border-b border-black/10 bg-white/90 shadow-[0_14px_34px_rgba(17,16,14,0.08)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-[min(calc(100%-20px),1480px)] items-center justify-between gap-2 min-[521px]:h-[72px] min-[521px]:w-[min(calc(100%-28px),1480px)] lg:h-[88px] xl:h-28">
        <div className="flex min-w-0 flex-1 items-center gap-7 xl:gap-16">
          <Link className="font-display text-[31px] font-bold leading-none text-[#080806] min-[521px]:text-4xl xl:text-[54px]" href="/">
            FitLook
          </Link>
          <nav className="hidden items-center gap-7 xl:flex 2xl:gap-9" aria-label="Primary navigation">
            {navItems.map((item, index) => {
              const active = isActiveNavItem(item.href, pathname, currentParams, index);
              return (
                <Link
                  className={cn(
                    "relative flex min-h-12 items-center text-[17px] text-[#4f4d4b] transition-colors after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:origin-left after:scale-x-75 after:rounded-pill after:bg-[#080806] after:opacity-0 after:transition",
                    active && "font-bold text-[#080806] after:scale-x-100 after:opacity-100",
                    "hover:text-[#080806] hover:after:scale-x-100 hover:after:opacity-100"
                  )}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <form
          className="hidden h-[70px] w-[min(22vw,360px)] min-w-[260px] items-center gap-4 rounded-pill border border-[#e4dcda] bg-[#f2edeb] px-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.74)] lg:flex"
          action="/search"
          role="search"
        >
          <button className="grid size-6 place-items-center text-[#141413]" type="submit" aria-label="Search">
            <Search className="size-[23px]" strokeWidth={1.8} />
          </button>
          <input
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[#171614] shadow-none outline-none placeholder:text-[#858087]"
            name="q"
            type="search"
            placeholder="Search curated collections..."
            aria-label="Search products"
          />
        </form>

        <div className="flex items-center gap-0 min-[521px]:gap-1 xl:gap-5">
          <Link className="hidden size-11 place-items-center text-[#080806] transition hover:-translate-y-0.5 md:grid" href="/wishlist" aria-label="Wishlist">
            <Heart className="size-[23px]" strokeWidth={1.8} />
          </Link>
          <Link className="hidden size-11 place-items-center text-[#080806] transition hover:-translate-y-0.5 md:grid" href="/tokens" aria-label="Credits">
            <ShoppingBag className="size-[23px]" strokeWidth={1.8} />
          </Link>
          <Link className="grid size-11 place-items-center text-[#080806] transition hover:-translate-y-0.5" href="/login" aria-label="Account">
            <User className="size-[23px]" strokeWidth={1.8} />
          </Link>
          <button
            className="grid size-11 place-items-center text-[#080806] xl:hidden"
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="size-6" strokeWidth={1.8} /> : <Menu className="size-6" strokeWidth={1.8} />}
          </button>
        </div>
      </div>

      <div className={cn("hidden border-t border-black/10 bg-white/95 backdrop-blur-xl xl:hidden", menuOpen && "block")}>
        <div className="mx-auto grid w-[min(calc(100%-28px),620px)] gap-1 py-4">
          <form
            className="mb-2 flex h-[52px] items-center gap-4 rounded-pill border border-[#e4dcda] bg-[#f2edeb] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.74)]"
            action="/search"
            role="search"
          >
            <button className="grid size-6 place-items-center text-[#141413]" type="submit" aria-label="Search">
              <Search className="size-[21px]" strokeWidth={1.8} />
            </button>
            <input
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-[#171614] shadow-none outline-none placeholder:text-[#858087]"
              name="q"
              type="search"
              placeholder="Search curated collections..."
              aria-label="Search products"
            />
          </form>
          {navItems.map((item, index) => {
            const active = isActiveNavItem(item.href, pathname, currentParams, index);
            return (
              <Link
                className={cn("flex min-h-12 items-center text-[15px] text-[#4f4d4b]", active && "font-bold text-[#080806]")}
                href={item.href}
                key={item.href}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
          <Link className="flex min-h-12 items-center text-[15px] text-[#4f4d4b]" href="/wishlist" onClick={() => setMenuOpen(false)}>
            Wishlist
          </Link>
          <Link className="flex min-h-12 items-center text-[15px] text-[#4f4d4b]" href="/tokens" onClick={() => setMenuOpen(false)}>
            Credits
          </Link>
        </div>
      </div>
    </header>
  );
}

function HomeNav() {
  return (
    <Suspense fallback={<HomeNavFallback />}>
      <HomeNavContent />
    </Suspense>
  );
}

function SectionHeader({ title, copy, href, actionLabel = "Explore all" }: SectionHeaderProps) {
  return (
    <div className="mb-10 flex items-end justify-between gap-6">
      <div>
        <h2 className="font-display text-4xl leading-none text-[#11100e] md:text-5xl">{title}</h2>
        {copy ? <p className="mt-4 max-w-md text-sm text-[#5f5b56]">{copy}</p> : null}
      </div>
      {href ? (
        <Link className="hidden items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#9d5f62] md:flex" href={href}>
          {actionLabel}
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative min-h-[560px] overflow-hidden bg-[#d6c2ae] md:min-h-[640px]">
      <Image className="object-cover object-center" src="/assets/hero1.png" alt="" fill priority sizes="100vw" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/10" aria-hidden="true" />
      <motion.div className="relative mx-auto flex min-h-[560px] w-[min(calc(100%-48px),1480px)] items-center md:min-h-[640px]" initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.65, ease: "easeOut" }}>
        <div className="max-w-xl pt-16">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.32em] text-[#35312d]">New Collection</p>
          <h1 className="font-display text-6xl font-bold leading-[0.92] text-[#11100e] md:text-8xl">
            Summer <span className="block italic text-[#9d5f62]">Essentials</span>
          </h1>
          <p className="mt-8 text-sm font-bold uppercase tracking-[0.18em] text-[#35312d]">Drop now live</p>
          <Link className="mt-6 inline-flex h-14 items-center gap-3 rounded-pill bg-[#080806] px-8 text-xs font-bold uppercase tracking-[0.12em] text-white" href="/search">
            Shop now
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </motion.div>
      <div className="absolute right-[8vw] top-[34%] hidden size-32 place-items-center rounded-full bg-white text-center font-display text-4xl font-bold leading-none text-[#11100e] shadow-sm md:grid">
        <span>
          <small className="block font-sans text-[10px] uppercase tracking-[0.16em]">Up to</small>
          50%
          <small className="block font-sans text-[10px] uppercase tracking-[0.16em]">Off</small>
        </span>
      </div>
    </section>
  );
}

function CategoryCard({ category }: CategoryCardProps) {
  return (
    <Link className="group grid justify-items-center gap-3 text-center" href={category.href}>
      <span className={cn("grid size-20 place-items-center overflow-hidden rounded-full bg-[#f2edeb] transition group-hover:-translate-y-1", category.tone === "sale" && "bg-[#080806] text-white")}>
        {category.image ? (
          <Image className="h-full w-full object-cover" src={category.image} alt="" width={80} height={80} sizes="80px" />
        ) : (
          <span className="text-xs font-bold uppercase tracking-[0.14em]">Sale</span>
        )}
      </span>
      <span className="text-xs font-semibold text-[#4f4d4b]">{category.label}</span>
    </Link>
  );
}

function ProductCard({ product, index }: ProductCardProps) {
  return (
    <motion.article className="group" initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={fadeUp} transition={{ delay: index * 0.04, duration: 0.45 }}>
      <Link className="block" href={product.href}>
        <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-[#eee8e2]">
          <Image className="object-cover transition duration-500 group-hover:scale-105" src={product.image} alt={product.name} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" />
          {product.badge ? <span className="absolute left-4 top-4 rounded-sm bg-[#080806] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white">{product.badge}</span> : null}
        </div>
        <div className="pt-5 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#77706a]">{product.category}</p>
          <h3 className="mt-1 font-display text-xl leading-tight text-[#11100e]">{product.name}</h3>
          <p className="mt-1 text-sm font-bold text-[#9d5f62]">{product.price}</p>
        </div>
      </Link>
    </motion.article>
  );
}

function CategoriesSection() {
  return (
    <section className="border-b border-[#eee7e3] bg-white py-12">
      <div className="mx-auto w-[min(calc(100%-48px),1480px)]">
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-[#11100e]">Shop by category</h2>
          <Link className="text-xs font-semibold text-[#9d5f62]" href="/categories">View all -&gt;</Link>
        </div>
        <div className="grid grid-cols-3 gap-6 sm:grid-cols-4 md:grid-cols-7">
          {categories.map((category) => <CategoryCard category={category} key={category.href} />)}
        </div>
      </div>
    </section>
  );
}

function ValueStrip() {
  return (
    <section className="bg-[#f7f2f0] py-8">
      <div className="mx-auto grid w-[min(calc(100%-48px),1480px)] gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {values.map((value) => {
          const Icon = value.icon;
          return (
            <div className="flex items-center gap-4" key={value.title}>
              <Icon className="size-5 text-[#9d5f62]" />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-[#11100e]">{value.title}</h3>
                <p className="text-xs text-[#5f5b56]">{value.copy}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FeaturedSection() {
  return (
    <section className="bg-white py-20 md:py-28">
      <div className="mx-auto w-[min(calc(100%-48px),1480px)]">
        <SectionHeader title="Seasonal Curations" copy="Essential pieces for the modern wardrobe." href="/search" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featuredProducts.map((product, index) => <ProductCard product={product} index={index} key={product.name} />)}
        </div>
      </div>
    </section>
  );
}

function PromoSection() {
  return (
    <section className="bg-[#f7f2f0] py-12">
      <div className="mx-auto grid w-[min(calc(100%-48px),1480px)] gap-6 md:grid-cols-2">
        {promos.map((promo) => {
          const Icon = promo.icon;
          return (
            <Link className={cn("flex min-h-48 items-center gap-8 rounded-lg px-8 transition hover:-translate-y-1", promo.variant === "dark" ? "bg-[#080806] text-white" : "bg-[#eee8e7] text-[#11100e]")} href={promo.href} key={promo.title}>
              <span className="grid size-16 place-items-center rounded-full border border-current/15">
                <Icon className="size-6" />
              </span>
              <span>
                <small className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">{promo.eyebrow}</small>
                <strong className="block font-display text-4xl uppercase leading-none md:text-5xl">{promo.title}</strong>
                <span className="mt-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#9d5f62]">{promo.copy}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function TrendingSection() {
  return (
    <section className="bg-white py-20 md:py-28">
      <div className="mx-auto w-[min(calc(100%-48px),1480px)]">
        <SectionHeader title="Shop the Look" href="/search?tag=essentials" actionLabel="View more" />
        <div className="grid gap-6 md:grid-cols-3">
          {trendingProducts.map((product, index) => <ProductCard product={product} index={index} key={product.name} />)}
        </div>
      </div>
    </section>
  );
}

function NewsletterSection() {
  return (
    <section className="border-t border-[#eee7e3] bg-white px-6 py-24 text-center">
      <div className="mx-auto max-w-3xl">
        <p className="mx-auto mb-8 text-3xl text-[#9d5f62]">✦</p>
        <h2 className="font-display text-5xl leading-tight text-[#11100e]">Join the Atelier</h2>
        <p className="mx-auto mt-5 max-w-xl text-sm text-[#5f5b56]">Subscribe to receive early access to seasonal drops, private invitations to the Virtual Atelier, and high-fashion insights.</p>
        <form className="mx-auto mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row">
          <input className="h-14 min-w-0 flex-1 rounded-md border-0 bg-[#f2edeb] px-6 text-sm text-[#11100e] shadow-none" type="email" placeholder="Your email address" aria-label="Email address" />
          <button className="h-14 rounded-md bg-[#080806] px-8 text-xs font-bold uppercase tracking-[0.14em] text-white" type="submit">Subscribe</button>
        </form>
      </div>
    </section>
  );
}

function HomeFooter() {
  return (
    <footer className="border-t border-[#e4dcda] bg-[#f7f2f0] py-16 text-[#11100e] md:py-24">
      <div className="mx-auto grid w-[min(calc(100%-48px),1480px)] gap-12 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Link className="font-display text-4xl font-bold" href="/">FitLook</Link>
          <p className="mt-6 max-w-xs text-sm leading-7 text-[#5f5b56]">Defining the intersection of artisanal craftsmanship and digital innovation. Curated for the modern visionary.</p>
          <div className="mt-8 flex gap-3">
            {socialLinks.map((social) => {
              const Icon = social.icon;
              return (
                <Link className="grid size-10 place-items-center rounded-full text-[#5f5b56] transition hover:bg-white hover:text-[#11100e]" href={social.href} key={social.label} aria-label={social.label}>
                  <Icon className="size-4" />
                </Link>
              );
            })}
          </div>
        </div>
        {footerColumns.map((column) => (
          <div key={column.title}>
            <h3 className="mb-6 text-xs font-bold uppercase tracking-[0.18em]">{column.title}</h3>
            <ul className="grid gap-3 text-sm text-[#5f5b56]">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link className="transition hover:text-[#11100e]" href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-16 flex w-[min(calc(100%-48px),1480px)] flex-col gap-4 border-t border-[#e4dcda] pt-8 text-xs text-[#77706a] md:flex-row md:items-center md:justify-between">
        <p>© 2024 FitLook. All rights reserved.</p>
        <div className="flex gap-8">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </div>
      </div>
    </footer>
  );
}

export function HomePage() {
  return (
    <main className="bg-white text-[#11100e]">
      <HomeNav />
      <HeroSection />
      <CategoriesSection />
      <ValueStrip />
      <FeaturedSection />
      <PromoSection />
      <TrendingSection />
      <NewsletterSection />
      <HomeFooter />
    </main>
  );
}
