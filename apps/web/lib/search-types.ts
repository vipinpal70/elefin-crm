export interface SearchHit {
  type: "client" | "account";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
