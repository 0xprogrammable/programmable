import Link from "next/link";
import { isWebsiteAdminWallet } from "@/lib/admin-access";

export function AdminDashboardLink({ account, authenticated, menuOpen, onNavigate }: {
  account: string | null;
  authenticated: boolean;
  menuOpen: boolean;
  onNavigate: () => void;
}) {
  if (!authenticated || !isWebsiteAdminWallet(account)) return null;
  return <Link href="/admin/modules" prefetch={false}
    tabIndex={menuOpen ? undefined : -1} onClick={onNavigate}>
    Admin Dashboard
  </Link>;
}
