import AdminDashboard from "@/components/AdminDashboard";
import LoginForm from "@/components/LoginForm";
import { hasAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (await hasAdminSession()) ? <AdminDashboard /> : <LoginForm />;
}
