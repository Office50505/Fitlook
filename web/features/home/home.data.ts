import type { ComponentType } from "react";
import { CreditCard, Flame, Globe2, Headphones, PackageCheck, Share2, Star, Tag, Truck } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
}

export interface CategoryItem {
  label: string;
  href: string;
  image?: string;
  tone?: "sale";
}

export interface ProductItem {
  name: string;
  category: string;
  price: string;
  href: string;
  image: string;
  badge?: string;
}

export interface ValueItem {
  title: string;
  copy: string;
  icon: ComponentType<{ className?: string }>;
}

export interface PromoItem {
  eyebrow: string;
  title: string;
  copy: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  variant: "dark" | "light";
}

export interface LookItem {
  title: string;
  href: string;
  image: string;
}

export interface FooterColumn {
  title: string;
  links: Array<{ label: string; href: string }>;
}

export const navItems: NavItem[] = [
  { label: "Shop", href: "/search" },
  { label: "Categories", href: "/categories" },
  { label: "Collections", href: "/search?newArrival=true" },
  { label: "Closet", href: "/closet" },
  { label: "AI Stylist", href: "/style-bot" }
];

export const categories: CategoryItem[] = [
  { label: "Tops", href: "/search?category=tops", image: "/assets/category-1.jpg" },
  { label: "Bottoms", href: "/search?category=bottoms", image: "/assets/category-3.jpg" },
  { label: "Dresses", href: "/search?category=dresses", image: "/assets/arrival-4.jpg" },
  { label: "Shoes", href: "/search?category=shoes", image: "/assets/category-6.jpg" },
  { label: "Accessories", href: "/search?category=accessories", image: "/assets/category-8.jpg" },
  { label: "Men", href: "/search?gender=men", image: "/assets/hero2.png" },
  { label: "Sale", href: "/sale", tone: "sale" }
];

export const featuredProducts: ProductItem[] = [
  { name: "Aura Runner Elite", category: "Sneakers", price: "$49.99", href: "/search?category=shoes", image: "/assets/category-6.jpg", badge: "New" },
  { name: "Chaotic Oversize", category: "Hoodie", price: "$59.99", href: "/search?category=tops", image: "/assets/arrival-2.jpg" },
  { name: "Nomad Gilet", category: "Puffer Vest", price: "$69.99", href: "/search?category=jackets", image: "/assets/trending-3.jpg" },
  { name: "Legacy Letterman", category: "Varsity Jacket", price: "$79.99", href: "/search?category=jackets", image: "/assets/trending-6.jpg" }
];

export const trendingProducts: ProductItem[] = [
  { name: "Urban Essentials", category: "Matching Set", price: "Shop look", href: "/search?tag=essentials", image: "/assets/hero1.png" },
  { name: "Ivory Atelier", category: "Suiting", price: "Shop look", href: "/search?tag=formal", image: "/assets/trending-2.jpg" },
  { name: "Midnight Utility", category: "Outerwear", price: "Shop look", href: "/search?tag=streetwear", image: "/assets/hero2.png" }
];

export const values: ValueItem[] = [
  { title: "Trending Now", copy: "Hot Right Now", icon: Flame },
  { title: "Best Sellers", copy: "Top Picks", icon: Star },
  { title: "New Arrivals", copy: "New Styles Added", icon: PackageCheck },
  { title: "Fast Delivery", copy: "Across The World", icon: Truck }
];

export const promos: PromoItem[] = [
  { eyebrow: "Limited Time Offer", title: "Up To 50% Off", copy: "Seasonal sale edit", href: "/sale", icon: Tag, variant: "dark" },
  { eyebrow: "Orders Over $75", title: "Free Shipping", copy: "Across eligible fashion drops", href: "/support", icon: Globe2, variant: "light" }
];

export const footerColumns: FooterColumn[] = [
  {
    title: "Collections",
    links: [
      { label: "New Arrivals", href: "/search?newArrival=true" },
      { label: "Men's Edit", href: "/search?gender=men" },
      { label: "Women's Edit", href: "/search?gender=women" },
      { label: "Accessories", href: "/search?category=accessories" },
      { label: "Seasonal Sale", href: "/sale" }
    ]
  },
  {
    title: "Company",
    links: [
      { label: "Journal", href: "/blog" },
      { label: "Sustainability", href: "/about" },
      { label: "Virtual Atelier", href: "/style-bot" },
      { label: "Contact", href: "/contact" },
      { label: "Shipping", href: "/support" }
    ]
  },
  {
    title: "Assurance",
    links: [
      { label: "100% Secure Payment", href: "/tokens" },
      { label: "24/7 Dedicated Support", href: "/support" },
      { label: "30-Day Effortless Returns", href: "/support" }
    ]
  }
];

export const socialLinks = [
  { label: "Instagram", href: "https://instagram.com/", icon: CreditCard },
  { label: "Share", href: "https://x.com/", icon: Share2 },
  { label: "Web", href: "/", icon: Globe2 },
  { label: "Support", href: "/support", icon: Headphones }
];
