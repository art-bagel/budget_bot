import type { LucideIcon } from 'lucide-react';
import {
  Baby, Bike, Book, Building2, Bus, Camera, Car, Coffee, Coins,
  Dumbbell, Film, Fuel, Gift, Globe, GraduationCap, Headphones,
  Heart, Home, Key, Leaf, Lightbulb, Music, Palette, PawPrint,
  Phone, Pill, Plane, Receipt, Scissors, ShoppingBag, ShoppingBasket,
  ShoppingCart, Shirt, Smile, Sofa, Sparkles, Star, Stethoscope,
  Sun, Train, Tv, Umbrella, Utensils, Wallet, Wrench,
  // extras
  Banknote, BarChart3, BedDouble, Briefcase, Bus as BusIcon,
  Candy, Clover, Dog, Flower2, Gamepad2, Hammer, HandCoins,
  Laptop, Package, Paintbrush, Percent, Plane as PlaneIcon,
  PiggyBank, Pizza, Plug, Printer, Puzzle, Router, Scale,
  ShowerHead, Snowflake, Syringe, Tent, Ticket, Trees, Trophy,
  Truck, Watch, Wine, Zap, Landmark, Cat, Backpack, BabyIcon,
} from 'lucide-react';

type IconEntry = LucideIcon;

export const CATEGORY_SVG_ICONS: Record<string, IconEntry> = {
  // Покупки
  cart:       ShoppingCart,
  basket:     ShoppingBasket,
  bag:        ShoppingBag,
  receipt:    Receipt,
  utensils:   Utensils,
  coffee:     Coffee,
  gift:       Gift,
  pizza:      Pizza,
  candy:      Candy,
  wine:       Wine,
  // Жильё
  home:       Home,
  building:   Building2,
  sofa:       Sofa,
  lightbulb:  Lightbulb,
  key:        Key,
  wrench:     Wrench,
  leaf:       Leaf,
  bed:        BedDouble,
  plug:       Plug,
  zap:        Zap,
  shower:     ShowerHead,
  hammer:     Hammer,
  // Транспорт
  car:        Car,
  bus:        Bus,
  fuel:       Fuel,
  plane:      Plane,
  bike:       Bike,
  train:      Train,
  truck:      Truck,
  // Здоровье
  heart:      Heart,
  tooth:      Smile,
  stethoscope:Stethoscope,
  pill:       Pill,
  dumbbell:   Dumbbell,
  sparkle:    Sparkles,
  syringe:    Syringe,
  // Досуг
  film:       Film,
  music:      Music,
  headphones: Headphones,
  camera:     Camera,
  tv:         Tv,
  book:       Book,
  gamepad:    Gamepad2,
  palette:    Palette,
  scissors:   Scissors,
  ticket:     Ticket,
  puzzle:     Puzzle,
  trophy:     Trophy,
  tent:       Tent,
  // Финансы
  wallet:     Wallet,
  coins:      Coins,
  chart:      BarChart3,
  star:       Star,
  sun:        Sun,
  banknote:   Banknote,
  piggybank:  PiggyBank,
  percent:    Percent,
  landmark:   Landmark,
  handcoins:  HandCoins,
  // Работа
  briefcase:  Briefcase,
  laptop:     Laptop,
  printer:    Printer,
  router:     Router,
  // Прочее
  shirt:      Shirt,
  umbrella:   Umbrella,
  graduation: GraduationCap,
  phone:      Phone,
  globe:      Globe,
  paw:        PawPrint,
  baby:       Baby,
  dog:        Dog,
  cat:        Cat,
  flower:     Flower2,
  trees:      Trees,
  clover:     Clover,
  snowflake:  Snowflake,
  watch:      Watch,
  scale:      Scale,
  package:    Package,
  paintbrush: Paintbrush,
  backpack:   Backpack,
};

export const CATEGORY_SVG_ICON_GROUPS: { label: string; codes: string[] }[] = [
  { label: 'Покупки',      codes: ['cart', 'basket', 'bag', 'receipt', 'utensils', 'coffee', 'pizza', 'candy', 'wine', 'gift'] },
  { label: 'Жильё',        codes: ['home', 'building', 'sofa', 'bed', 'lightbulb', 'plug', 'zap', 'shower', 'key', 'wrench', 'hammer', 'leaf'] },
  { label: 'Транспорт',    codes: ['car', 'bus', 'fuel', 'plane', 'bike', 'train', 'truck'] },
  { label: 'Здоровье',     codes: ['heart', 'tooth', 'stethoscope', 'pill', 'syringe', 'dumbbell', 'sparkle'] },
  { label: 'Досуг',        codes: ['film', 'music', 'headphones', 'camera', 'tv', 'book', 'gamepad', 'palette', 'paintbrush', 'scissors', 'ticket', 'puzzle', 'trophy', 'tent'] },
  { label: 'Финансы',      codes: ['wallet', 'coins', 'banknote', 'piggybank', 'chart', 'percent', 'landmark', 'handcoins', 'star', 'sun'] },
  { label: 'Работа',       codes: ['briefcase', 'laptop', 'printer', 'router', 'graduation'] },
  { label: 'Прочее',       codes: ['shirt', 'umbrella', 'phone', 'globe', 'watch', 'scale', 'package', 'backpack', 'snowflake', 'flower', 'trees', 'clover', 'paw', 'dog', 'cat', 'baby'] },
];

export function CategorySvgIcon({ code }: { code: string }) {
  const Icon = CATEGORY_SVG_ICONS[code];
  if (!Icon) return null;
  return <Icon size={18} strokeWidth={1.8} />;
}
