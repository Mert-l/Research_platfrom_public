import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function ResearchLogin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);

  const handleLogin = async () => {
    if (!password.trim()) {
      toast({
        title: "Missing password",
        description: "Please enter the researcher password.",
        variant: "destructive",
      });
      return;
    }

    setChecking(true);

    try {
      const response = await fetch(`${API_BASE}/api/research-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Researcher login failed");
      }

      localStorage.setItem("researcher_logged_in", "true");
      localStorage.removeItem("parrot_owner_email");

      toast({
        title: "Researcher login successful",
        description: "You now have access to the researcher dashboard.",
      });

      navigate("/research");
    } catch (error) {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <CardTitle>Researcher Login</CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This area is only for the researcher. The password is checked on the
            server, so it is not exposed in the frontend bundle.
          </p>

          <div className="space-y-2">
            <Label>Researcher Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleLogin();
              }}
            />
          </div>

          <Button onClick={handleLogin} className="w-full" disabled={checking}>
            {checking ? "Checking..." : "Log In as Researcher"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
