export interface SearchHit {
  type: "client" | "account" | "xm_trader";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
