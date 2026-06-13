import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Server, Save } from "lucide-react";

const EMAIL_CONFIG_KEY = "cpi.emailConfig";

interface EmailConfig {
  host: string;
  port: string;
  emailAddress: string;
  appPassword: string;
}

const DEFAULT_CONFIG: EmailConfig = {
  host: "smtp-mail.outlook.com",
  port: "587",
  emailAddress: "",
  appPassword: "",
};

const EmailSettingsConfig = () => {
  const [config, setConfig] = useState<EmailConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    const stored = localStorage.getItem(EMAIL_CONFIG_KEY);
    if (stored) {
      try {
        setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(stored) });
      } catch {
        // ignore malformed stored data
      }
    }
  }, []);

  const set =
    (field: keyof EmailConfig) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setConfig((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSave = () => {
    localStorage.setItem(EMAIL_CONFIG_KEY, JSON.stringify(config));
    toast.success("Email configuration saved.");
  };

  return (
    <div className="rounded-xl p-6 bg-card text-card-foreground border border-border">
      <div className="flex items-center gap-2 mb-6">
        <Mail className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">Outlook Email Configuration</h2>
      </div>

      <div className="space-y-4 max-w-lg">
        <div className="space-y-1.5">
          <Label>SMTP Host</Label>
          <div className="relative">
            <Server className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={config.host}
              onChange={set("host")}
              placeholder="smtp-mail.outlook.com"
              className="pl-10"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Port</Label>
          <Input
            value={config.port}
            onChange={set("port")}
            placeholder="587"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Email Address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="email"
              value={config.emailAddress}
              onChange={set("emailAddress")}
              placeholder="you@cpi.com.ph"
              className="pl-10"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>App Password</Label>
          <Input
            type="password"
            value={config.appPassword}
            onChange={set("appPassword")}
            placeholder="••••••••••••••••"
          />
          <p className="text-xs text-muted-foreground">
            Use an app-specific password from your Microsoft account security settings, not your regular login password.
          </p>
        </div>

        <Button onClick={handleSave} className="gap-2">
          <Save className="h-4 w-4" />
          Save Configuration
        </Button>
      </div>
    </div>
  );
};

export default EmailSettingsConfig;
