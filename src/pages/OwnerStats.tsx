import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Music, MousePointerClick, Star } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface LogEntry {
  timestamp: string;
  owner_email?: string;
  button: number;
  soundfile: string;
}

type OwnerStatsChartId = "buttonPresses" | "soundsPlayed";

const chartOptions: { id: OwnerStatsChartId; label: string }[] = [
  { id: "buttonPresses", label: "Button Presses" },
  { id: "soundsPlayed", label: "Sounds Played" },
];

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

function cleanEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function cleanSoundName(value: string) {
  if (!value) return "";

  const fileName = String(value).split("/").pop() || value;

  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+-/, "")
    .replace(/^[^_]+__/, "")
    .replace(/_/g, " ");
}

export default function OwnerStats() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [buttonNames, setButtonNames] = useState<Record<number, string>>({
    1: "No sound assigned",
    2: "No sound assigned",
    3: "No sound assigned",
    4: "No sound assigned",
  });

  const [visibleCharts, setVisibleCharts] = useState<
    Record<OwnerStatsChartId, boolean>
  >({
    buttonPresses: true,
    soundsPlayed: true,
  });

  const [searchParams] = useSearchParams();

  const researcherSelectedEmail = searchParams.get("owner_email") || "";

  const ownerEmail =
    researcherSelectedEmail ||
    localStorage.getItem("parrot_owner_email") ||
    "";

  const loadLogs = async () => {
    const res = await fetch(`${API_BASE}/api/logs`);

    if (!res.ok) {
      throw new Error("Could not load logs");
    }

    const data = await res.json();
    const allLogs: LogEntry[] = data.logs || [];

    setLogs(
      allLogs.filter(
        (log) => cleanEmail(log.owner_email || "") === cleanEmail(ownerEmail)
      )
    );
  };

  const loadButtonNames = async () => {
    if (!ownerEmail) return;

    const { data, error } = await supabase
      .from("device_configs")
      .select("buttons")
      .eq("owner_email", cleanEmail(ownerEmail))
      .maybeSingle();

    if (error) {
      console.error(error);
      return;
    }

    const buttons = data?.buttons || {};

    setButtonNames({
      1: buttons["1"] ? cleanSoundName(buttons["1"]) : "No sound assigned",
      2: buttons["2"] ? cleanSoundName(buttons["2"]) : "No sound assigned",
      3: buttons["3"] ? cleanSoundName(buttons["3"]) : "No sound assigned",
      4: buttons["4"] ? cleanSoundName(buttons["4"]) : "No sound assigned",
    });
  };

  useEffect(() => {
    if (!ownerEmail) return;

    loadLogs();
    loadButtonNames();
  }, [ownerEmail]);

  const totalPresses = logs.length;

  const topSounds = useMemo(() => {
    const counts = new Map<string, number>();

    logs.forEach((log) => {
      const sound = log.soundfile ? cleanSoundName(log.soundfile) : "Unassigned";
      counts.set(sound, (counts.get(sound) || 0) + 1);
    });

    return [...counts.entries()]
      .map(([name, plays]) => ({ name, plays }))
      .sort((a, b) => b.plays - a.plays);
  }, [logs]);

  const buttonStats = useMemo(() => {
    const counts = new Map<number, number>();

    [1, 2, 3, 4].forEach((button) => counts.set(button, 0));

    logs.forEach((log) => {
      counts.set(log.button, (counts.get(log.button) || 0) + 1);
    });

    return [...counts.entries()].map(([button, presses]) => ({
      button: `Button ${button}`,
      assignedSound: buttonNames[button] || "No sound assigned",
      presses,
    }));
  }, [logs, buttonNames]);

  const favoriteSound = topSounds[0]?.name || "No data yet";

  const toggleChart = (id: OwnerStatsChartId, checked: boolean) => {
    setVisibleCharts((current) => ({
      ...current,
      [id]: checked,
    }));
  };

  const hasVisibleCharts = Object.values(visibleCharts).some(Boolean);

  if (!ownerEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Parrot Stats</CardTitle>
        </CardHeader>

        <CardContent>
          <p className="text-muted-foreground">
            Please save your owner profile first. Your email is needed to show only your parrot&apos;s statistics.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          My Parrot Stats
        </h1>
        <p className="text-muted-foreground mt-1">
          Statistics only for the parrot registered with: {ownerEmail}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <MousePointerClick className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total Presses</p>
              <p className="text-2xl font-bold">{totalPresses}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <Star className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Favorite Sound</p>
              <p className="text-lg font-bold truncate">{favoriteSound}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <Music className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">
                Different Sounds Played
              </p>
              <p className="text-2xl font-bold">{topSounds.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        <Card className="lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle className="text-base">Visible statistics</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {chartOptions.map((option) => (
              <label
                key={option.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <Checkbox
                  checked={visibleCharts[option.id]}
                  onCheckedChange={(checked) =>
                    toggleChart(option.id, checked === true)
                  }
                />
                {option.label}
              </label>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {!hasVisibleCharts && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                No statistics selected. Tick a box on the left to show a graph.
              </CardContent>
            </Card>
          )}

          {visibleCharts.buttonPresses && (
            <Card>
              <CardHeader>
                <CardTitle>Button Presses</CardTitle>
              </CardHeader>

              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={buttonStats}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="button" />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(value, name, props) => {
                        if (name === "presses") {
                          return [
                            value,
                            `Presses — `,
                          ];
                        }

                        return [value, name];
                      }}
                      labelFormatter={(label) => {
                        const row = buttonStats.find(
                          (item) => item.button === label
                        );

                        return row
                          ? `${label}: ${row.assignedSound}`
                          : String(label);
                      }}
                    />
                    <Bar
                      dataKey="presses"
                      fill="hsl(201, 96%, 39%)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {visibleCharts.soundsPlayed && (
            <Card>
              <CardHeader>
                <CardTitle>Sounds Played</CardTitle>
              </CardHeader>

              <CardContent>
                {topSounds.length === 0 ? (
                  <p className="text-muted-foreground">
                    No button presses yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {topSounds.map((sound) => (
                      <div
                        key={sound.name}
                        className="flex justify-between border-b py-2 text-sm"
                      >
                        <span>{sound.name}</span>
                        <span>{sound.plays} plays</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}