import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
  Label,
} from "recharts";
import {
  Download,
  Music,
  MousePointerClick,
  Star,
  RefreshCw,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface LogEntry {
  timestamp: number;
  button: number;
  soundfile: string;
  owner_email?: string;
}

interface OwnerProfile {
  id?: string;
  owner_name: string | null;
  email: string | null;
  parrot_name: string | null;
  species: string | null;
  age: number | null;
  gender: string | null;
  environment: string | null;
  agreement_accepted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

type ResearchChartId =
  | "topSounds"
  | "buttonDistribution"
  | "dailyPresses"
  | "timeOfDay";

const chartOptions: { id: ResearchChartId; label: string }[] = [
  { id: "topSounds", label: "Top Sounds" },
  { id: "buttonDistribution", label: "Button Press Distribution" },
  { id: "dailyPresses", label: "Daily Button Presses" },
  { id: "timeOfDay", label: "Time-of-Day Patterns" },
];

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

const buttonColors: Record<number, string> = {
  1: "hsl(201, 96%, 39%)",
  2: "hsl(199, 92%, 61%)",
  3: "hsl(215, 25%, 34%)",
  4: "hsl(210, 20%, 60%)",
};

function formatDateTime(timestamp: number) {
  if (!timestamp || Number.isNaN(timestamp)) return "Unknown";
  return new Date(timestamp).toLocaleString();
}

function exportCSV(logs: LogEntry[]) {
  const headers = ["timestamp", "datetime", "owner_email", "button", "soundfile"];

  const rows = logs.map((d) =>
    [
      d.timestamp,
      new Date(d.timestamp).toISOString(),
      d.owner_email || "",
      d.button,
      d.soundfile,
    ].join(",")
  );

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "parrot-button-press-log.csv";
  a.click();

  URL.revokeObjectURL(url);
}

export default function Research() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [profiles, setProfiles] = useState<OwnerProfile[]>([]);
  const [visibleCharts, setVisibleCharts] = useState<Record<ResearchChartId, boolean>>({
    topSounds: true,
    buttonDistribution: true,
    dailyPresses: true,
    timeOfDay: true,
  });

  const loadLogs = async () => {
    const res = await fetch(`${API_BASE}/api/logs`);

    if (!res.ok) {
      throw new Error("Could not load logs");
    }

    const data = await res.json();
    setLogs(data.logs || []);
  };

  const loadProfiles = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) {
      setProfiles(data || []);
    }
  };

  const refreshAll = async () => {
    try {
      await Promise.all([loadLogs(), loadProfiles()]);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const totalPresses = logs.length;

  const topSongs = useMemo(() => {
    const counts = new Map<string, number>();

    logs.forEach((l) =>
      counts.set(
        l.soundfile || "Unassigned",
        (counts.get(l.soundfile || "Unassigned") || 0) + 1
      )
    );

    return [...counts.entries()]
      .map(([name, plays]) => ({ name, plays }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);
  }, [logs]);

  const buttonDist = useMemo(() => {
    const counts = new Map<number, number>();

    [1, 2, 3, 4].forEach((id) => counts.set(id, 0));

    logs.forEach((l) => counts.set(l.button, (counts.get(l.button) || 0) + 1));

    return [...counts.entries()].map(([button, value]) => ({
      name: `Button ${button}`,
      value,
      color: buttonColors[button],
    }));
  }, [logs]);

  const dailyPresses = useMemo(() => {
    const counts = new Map<string, number>();

    logs.forEach((l) => {
      const day = new Date(l.timestamp).toLocaleDateString(undefined, {
        weekday: "short",
      });

      counts.set(day, (counts.get(day) || 0) + 1);
    });

    return [...counts.entries()].map(([date, presses]) => ({
      date,
      presses,
    }));
  }, [logs]);

  const hourlyPattern = useMemo(() => {
    const counts = new Map<string, number>();

    logs.forEach((l) => {
      const hour = new Date(l.timestamp).toLocaleTimeString(undefined, {
        hour: "2-digit",
        hour12: false,
      });

      counts.set(hour, (counts.get(hour) || 0) + 1);
    });

    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, presses]) => ({
        hour,
        presses,
      }));
  }, [logs]);

  const ownerStats = useMemo(() => {
    return profiles.map((profile) => {
      const ownerLogs = logs.filter(
        (log) => profile.email && log.owner_email === profile.email
      );

      const favorite = ownerLogs.reduce<Record<string, number>>((acc, log) => {
        const key = log.soundfile || "Unassigned";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      const favoriteSound =
        Object.entries(favorite).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        "No data yet";

      return {
        ...profile,
        totalPresses: ownerLogs.length,
        favoriteSound,
      };
    });
  }, [profiles, logs]);

  const favoriteSong = topSongs[0]?.name || "No data yet";

  const songsAssigned = new Set(logs.map((l) => l.soundfile).filter(Boolean)).size;

  const activityStats = [
    {
      label: "Registered Owners",
      value: String(profiles.length),
      icon: Users,
    },
    {
      label: "Total Button Presses",
      value: String(totalPresses),
      icon: MousePointerClick,
    },
    {
      label: "Favorite Sound",
      value: favoriteSong,
      icon: Star,
    },
    {
      label: "Sounds Played",
      value: String(songsAssigned),
      icon: Music,
    },
  ];

  const toggleChart = (id: ResearchChartId, checked: boolean) => {
    setVisibleCharts((current) => ({
      ...current,
      [id]: checked,
    }));
  };

  const hasVisibleCharts = Object.values(visibleCharts).some(Boolean);

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Research Dashboard
          </h1>

          <p className="text-muted-foreground mt-1">
            Overview of registered owners and device button-press data.
          </p>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>

          <Button size="sm" onClick={() => exportCSV(logs)}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {activityStats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <s.icon className="h-5 w-5 text-primary" />

                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>

                  <p className="text-2xl font-bold truncate max-w-64">
                    {s.value}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered Owners</CardTitle>
        </CardHeader>

        <CardContent>
          {ownerStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No owners registered yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Owner</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Parrot</th>
                    <th className="py-2 pr-4">Species</th>
                    <th className="py-2 pr-4">Age</th>
                    <th className="py-2 pr-4">Environment</th>
                    <th className="py-2 pr-4">Presses</th>
                    <th className="py-2 pr-4">Favorite sound</th>
                    <th className="py-2 pr-4">Agreement</th>
                  </tr>
                </thead>

                <tbody>
                  {ownerStats.map((owner) => (
                    <tr key={owner.email || owner.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{owner.owner_name || "-"}</td>
                      <td className="py-2 pr-4">{owner.email || "-"}</td>
                      <td className="py-2 pr-4">{owner.parrot_name || "-"}</td>
                      <td className="py-2 pr-4">{owner.species || "-"}</td>
                      <td className="py-2 pr-4">{owner.age ?? "-"}</td>
                      <td className="py-2 pr-4">{owner.environment || "-"}</td>
                      <td className="py-2 pr-4">{owner.totalPresses}</td>
                      <td className="py-2 pr-4">{owner.favoriteSound}</td>
                      <td className="py-2 pr-4">
                        {owner.agreement_accepted ? "Accepted" : "Not accepted"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {logs.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No button presses logged yet. Only real device presses should appear here.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-6 items-start">
        <Card className="xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="text-base">Visible graphs</CardTitle>
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

        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6 min-w-0">
          {!hasVisibleCharts && (
            <Card className="2xl:col-span-2">
              <CardContent className="pt-6 text-sm text-muted-foreground">
                No graphs selected. Tick a box on the left to show a graph.
              </CardContent>
            </Card>
          )}

          {visibleCharts.topSounds && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-base">Top Sounds</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Shows which sound files were played most often after device button presses.
                </p>
              </CardHeader>

              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart
                    data={topSongs}
                    layout="vertical"
                    margin={{ top: 10, right: 35, left: 95, bottom: 45 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 89%)" />

                    <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false}>
                      <Label value="Number of plays" offset={-30} position="insideBottom" />
                    </XAxis>

                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 12 }}
                      width={95}
                    >
                      <Label
                        value="Sound file"
                        angle={-90}
                        position="insideLeft"
                        style={{ textAnchor: "middle" }}
                      />
                    </YAxis>

                    <Tooltip />

                    <Bar
                      dataKey="plays"
                      name="Number of plays"
                      fill="hsl(201, 96%, 39%)"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {visibleCharts.buttonDistribution && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-base">Button Press Distribution</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Shows what percentage of all device presses came from each physical button.
                </p>
              </CardHeader>

              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                    <Pie
                      data={buttonDist}
                      cx="50%"
                      cy="45%"
                      innerRadius={55}
                      outerRadius={90}
                      dataKey="value"
                      nameKey="name"
                      labelLine={false}
                    >
                      {buttonDist.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>

                    <Tooltip
                      formatter={(value, name) => [`${value} presses`, name]}
                    />

                    <Legend
                      verticalAlign="bottom"
                      align="center"
                      formatter={(value) => {
                        const item = buttonDist.find((b) => b.name === value);
                        const percent =
                          totalPresses > 0 && item
                            ? ` (${Math.round((item.value / totalPresses) * 100)}%)`
                            : "";
                        return `${value}${percent}`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {visibleCharts.dailyPresses && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-base">Daily Button Presses</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Shows how many device button presses happened on each day of the week.
                </p>
              </CardHeader>

              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart
                    data={dailyPresses}
                    margin={{ top: 10, right: 35, left: 20, bottom: 45 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 89%)" />

                    <XAxis dataKey="date" tick={{ fontSize: 12 }}>
                      <Label value="Day of week" offset={-30} position="insideBottom" />
                    </XAxis>

                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false}>
                      <Label
                        value="Number of presses"
                        angle={-90}
                        position="insideLeft"
                        style={{ textAnchor: "middle" }}
                      />
                    </YAxis>

                    <Tooltip />

                    <Area
                      type="monotone"
                      dataKey="presses"
                      name="Number of presses"
                      stroke="hsl(201, 96%, 39%)"
                      fill="hsl(199, 92%, 61%)"
                      fillOpacity={0.2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {visibleCharts.timeOfDay && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-base">Time-of-Day Patterns</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Shows at which hours of the day the device was pressed most often.
                </p>
              </CardHeader>

              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart
                    data={hourlyPattern}
                    margin={{ top: 10, right: 35, left: 20, bottom: 45 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 89%)" />

                    <XAxis dataKey="hour" tick={{ fontSize: 12 }}>
                      <Label value="Hour of day" offset={-30} position="insideBottom" />
                    </XAxis>

                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false}>
                      <Label
                        value="Number of presses"
                        angle={-90}
                        position="insideLeft"
                        style={{ textAnchor: "middle" }}
                      />
                    </YAxis>

                    <Tooltip />

                    <Bar
                      dataKey="presses"
                      name="Number of presses"
                      fill="hsl(199, 92%, 61%)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Button Presses</CardTitle>
        </CardHeader>

        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent logs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Owner email</th>
                    <th className="py-2 pr-4">Button</th>
                    <th className="py-2 pr-4">Sound</th>
                  </tr>
                </thead>

                <tbody>
                  {logs
                    .slice(-10)
                    .reverse()
                    .map((log, index) => (
                      <tr
                        key={`${log.timestamp}-${index}`}
                        className="border-b last:border-0"
                      >
                        <td className="py-2 pr-4">
                          {formatDateTime(log.timestamp)}
                        </td>

                        <td className="py-2 pr-4">{log.owner_email || "-"}</td>

                        <td className="py-2 pr-4">Button {log.button}</td>

                        <td className="py-2 pr-4">
                          {log.soundfile || "Unassigned"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}