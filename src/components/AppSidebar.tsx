import { BarChart3, Cpu, Lock, LogOut, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

function getCurrentOwnerEmail() {
  return String(localStorage.getItem("parrot_owner_email") || "")
    .trim()
    .toLowerCase();
}

function isResearcherLoggedIn() {
  return localStorage.getItem("researcher_logged_in") === "true";
}

export function AppSidebar() {
  const { state, isMobile, setOpen, setOpenMobile } = useSidebar();
  const navigate = useNavigate();

  const collapsed = state === "collapsed";
  const ownerEmail = getCurrentOwnerEmail();
  const researcher = isResearcherLoggedIn();

  const closeSidebarAfterNavigation = () => {
    if (isMobile) {
      setOpenMobile(false);
      return;
    }

    // Desktop: collapse back to icon-only after the user chooses a tab.
    setOpen(false);
  };

  const handleLogout = () => {
    localStorage.removeItem("parrot_owner_email");
    localStorage.removeItem("researcher_logged_in");
    closeSidebarAfterNavigation();
    navigate("/profile");
  };

  const ownerItems = [
    { title: "Device", url: "/", icon: Cpu },
    { title: "Owner Profile / Register", url: "/profile", icon: User },
    { title: "My Stats", url: "/my-stats", icon: BarChart3 },
    { title: "Researcher Login", url: "/research-login", icon: Lock },
  ];

  const researcherItems = [
    { title: "Device", url: "/", icon: Cpu },
    { title: "Research Dashboard", url: "/research", icon: Lock },
  ];

  const items = researcher ? researcherItems : ownerItems;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="p-4 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold text-sm shrink-0">
            PD
          </div>

          {!collapsed && (
            <span className="font-semibold text-sidebar-foreground text-lg tracking-tight">
              Parrot Device
            </span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>
            {researcher ? "Research Dashboard" : "Owner Dashboard"}
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      onClick={closeSidebarAfterNavigation}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>

            {!researcher && ownerEmail && !collapsed && (
              <p className="px-2 pt-3 text-xs text-muted-foreground break-all">
                Owner: {ownerEmail}
              </p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Log Out</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
