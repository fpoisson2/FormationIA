import { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAdminAuth } from "../providers/AdminAuthProvider";

const ADMIN_ROLES = ["admin", "superadmin", "administrator"];

const normaliseRoles = (roles: string[] | undefined | null): string[] =>
  (roles ?? []).map((role) => role.toLowerCase().trim());

const canAccessAdmin = (roles: string[]): boolean =>
  roles.some((role) => ADMIN_ROLES.includes(role));

interface LayoutProps {
  currentStep: number;
}

const STEPS = [
  { number: 1, label: "Préparer", path: "/stepsequence/etape-1" },
  { number: 2, label: "Explorer", path: "/stepsequence/etape-2" },
  { number: 3, label: "Synthétiser", path: "/stepsequence/etape-3" },
];

function Layout({ currentStep }: LayoutProps): JSX.Element {
  return <></>;
}

export default Layout;
