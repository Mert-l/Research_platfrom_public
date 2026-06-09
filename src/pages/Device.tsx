import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Music, Upload, Play, Pause, X, Save, Shuffle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface SoundFile {
  name: string;
  label?: string;
  duration_ms?: number | null;
}

interface ButtonConfig {
  id: number;
  color: string;
  label: string;
  songName: string;
  soundFile: string;
  audioUrl: string | null;
}

const buttonColors: Record<number, string> = {
  1: "hsl(201, 96%, 39%)",
  2: "hsl(199, 92%, 61%)",
  3: "hsl(215, 25%, 14%)",
  4: "hsl(210, 20%, 60%)",
};

const emptyButtons: ButtonConfig[] = [1, 2, 3, 4].map((id) => ({
  id,
  color: buttonColors[id],
  label: String(id),
  songName: "",
  soundFile: "",
  audioUrl: null,
}));

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

const MAX_AUDIO_SECONDS = 120;
const allowedAudioTypes = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"];
const allowedAudioExtensions = [".mp3", ".wav"];

function getSoundUrl(fileName: string) {
  return `${API_BASE}/api/sounds/${encodeURIComponent(fileName)}`;
}

function getCurrentOwnerEmail() {
  return String(localStorage.getItem("parrot_owner_email") || "").trim().toLowerCase();
}

function shuffleArray<T>(items: T[]) {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read audio duration"));
    };
    audio.src = url;
  });
}

function isAllowedAudioFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return allowedAudioTypes.includes(file.type) || allowedAudioExtensions.some((ext) => lowerName.endsWith(ext));
}

export default function Device() {
  const [buttons, setButtons] = useState<ButtonConfig[]>(emptyButtons);
  const [sounds, setSounds] = useState<SoundFile[]>([]);
  const [selectedButton, setSelectedButton] = useState<ButtonConfig | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tempSongName, setTempSongName] = useState("");
  const [tempSoundFile, setTempSoundFile] = useState("");
  const [tempUploadFile, setTempUploadFile] = useState<File | null>(null);
  const [tempUploadDurationMs, setTempUploadDurationMs] = useState<number | null>(null);
  const [tempAudioUrl, setTempAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activePreviewButtonId, setActivePreviewButtonId] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const soundLabel = useMemo(() => {
    const map = new Map<string, string>();
    sounds.forEach((s) => {
      map.set(s.name, s.label || s.name.replace(/\.[^.]+$/, ""));
    });
    return map;
  }, [sounds]);

  const buildButtonsFromConfig = (config: Record<string, string>, labels: Map<string, string>) => {
    return [1, 2, 3, 4].map((id) => {
      const soundFile = config[String(id)] || "";
      return {
        id,
        color: buttonColors[id],
        label: String(id),
        songName: labels.get(soundFile) || soundFile.replace(/\.[^.]+$/, ""),
        soundFile,
        audioUrl: soundFile ? getSoundUrl(soundFile) : null,
      };
    });
  };

  const loadSounds = async () => {
    const res = await fetch(`${API_BASE}/api/sounds`);
    if (!res.ok) throw new Error("Could not load sounds");

    const data = await res.json();
    return data.sounds || [];
  };

  const loadUserConfig = async (ownerEmail: string) => {
    const { data, error } = await supabase
      .from("device_configs")
      .select("buttons")
      .eq("owner_email", ownerEmail)
      .maybeSingle();

    if (error) throw error;

    return data?.buttons || { "1": "", "2": "", "3": "", "4": "" };
  };

  const refreshConfig = async () => {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      toast({
        title: "No owner profile",
        description: "Please save an owner profile first so the button setup can be saved separately.",
        variant: "destructive",
      });
      return;
    }

    try {
      const loadedSounds = await loadSounds();

      const loadedSoundLabel = new Map<string, string>();
      loadedSounds.forEach((s: SoundFile) => {
        loadedSoundLabel.set(s.name, s.label || s.name.replace(/\.[^.]+$/, ""));
      });

      const config = await loadUserConfig(ownerEmail);

      setSounds(loadedSounds);
      setButtons(buildButtonsFromConfig(config, loadedSoundLabel));
    } catch (error) {
      toast({
        title: "Could not load device config",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    refreshConfig();
  }, []);

  useEffect(() => {
    if (!sounds.length) return;
    setButtons((prev) =>
      prev.map((b) => ({
        ...b,
        songName: soundLabel.get(b.soundFile) || b.songName,
      }))
    );
  }, [sounds, soundLabel]);

  const openConfig = (btn: ButtonConfig) => {
    setSelectedButton(btn);
    setTempSongName(btn.songName);
    setTempSoundFile(btn.soundFile);
    setTempUploadFile(null);
    setTempUploadDurationMs(null);
    setTempAudioUrl(btn.audioUrl);
    setIsPlaying(false);
    setSheetOpen(true);
  };

  const handleSoundSelect = (fileName: string) => {
    setTempSoundFile(fileName);
    setTempUploadFile(null);
    setTempUploadDurationMs(null);
    setTempSongName(soundLabel.get(fileName) || fileName.replace(/\.[^.]+$/, ""));
    setTempAudioUrl(getSoundUrl(fileName));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isAllowedAudioFile(file)) {
      toast({
        title: "Invalid file",
        description: "Only MP3 and WAV files are allowed.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    try {
      const durationSeconds = await getAudioDuration(file);
      if (durationSeconds > MAX_AUDIO_SECONDS) {
        toast({
          title: "File too long",
          description: "Sound files must be maximum 2 minutes.",
          variant: "destructive",
        });
        e.target.value = "";
        return;
      }

      setTempUploadFile(file);
      setTempUploadDurationMs(Math.round(durationSeconds * 1000));
      setTempSoundFile(file.name);
      setTempSongName((current) => current.trim() || file.name.replace(/\.[^.]+$/, ""));
      setTempAudioUrl(URL.createObjectURL(file));
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Could not read this audio file.",
        variant: "destructive",
      });
      e.target.value = "";
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const saveMappingToSupabase = async (nextButtons: ButtonConfig[]) => {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      throw new Error("No owner email found. Please save an owner profile first.");
    }

    const payload = {
      owner_email: ownerEmail,
      buttons: Object.fromEntries(nextButtons.map((b) => [String(b.id), b.soundFile])),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("device_configs")
      .upsert(payload, { onConflict: "owner_email" });

    if (error) throw error;
  };

  const handleShuffleButtonSounds = async () => {
    const assignedSoundFiles = buttons.map((button) => button.soundFile).filter(Boolean);
    const uniqueAssignedSoundFiles = new Set(assignedSoundFiles);

    if (assignedSoundFiles.length !== buttons.length) {
      toast({
        title: "Cannot shuffle yet",
        description: "All 4 buttons need a sound before shuffling.",
        variant: "destructive",
      });
      return;
    }

    if (uniqueAssignedSoundFiles.size !== buttons.length) {
      toast({
        title: "Duplicate sounds found",
        description: "Each button must have a different sound before shuffling.",
        variant: "destructive",
      });
      return;
    }

    try {
      let shuffledSounds = shuffleArray(
        buttons.map((button) => ({
          soundFile: button.soundFile,
          songName: button.songName,
        }))
      );

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const changedSomething = shuffledSounds.some(
          (sound, index) => sound.soundFile !== buttons[index].soundFile
        );

        if (changedSomething) break;
        shuffledSounds = shuffleArray(shuffledSounds);
      }

      const nextButtons = buttons.map((button, index) => {
        const nextSound = shuffledSounds[index];

        return {
          ...button,
          soundFile: nextSound.soundFile,
          songName:
            soundLabel.get(nextSound.soundFile) ||
            nextSound.songName ||
            nextSound.soundFile.replace(/\.[^.]+$/, ""),
          audioUrl: nextSound.soundFile ? getSoundUrl(nextSound.soundFile) : null,
        };
      });

      await saveMappingToSupabase(nextButtons);
      setButtons(nextButtons);

      toast({
        title: "Sounds shuffled",
        description: "Your button sounds were shuffled and saved to your profile.",
      });
    } catch (error) {
      toast({
        title: "Shuffle failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!selectedButton) return;

    try {
      let finalSoundFile = tempSoundFile;
      let finalLabel = tempSongName.trim();

      if (tempUploadFile) {
        const data = await fileToDataUrl(tempUploadFile);

        const uploadRes = await fetch(`${API_BASE}/api/sounds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tempUploadFile.name,
            label: finalLabel,
            data,
            duration_ms: tempUploadDurationMs,
          }),
        });

        const uploaded = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploaded.error || "Could not upload sound file");

        finalSoundFile = uploaded.sound;
        finalLabel = uploaded.metadata?.label || finalLabel || finalSoundFile.replace(/\.[^.]+$/, "");
      }

      const nextButtons = buttons.map((b) =>
        b.id === selectedButton.id
          ? {
              ...b,
              songName: finalLabel,
              soundFile: finalSoundFile,
              audioUrl: finalSoundFile ? getSoundUrl(finalSoundFile) : null,
            }
          : b
      );

      await saveMappingToSupabase(nextButtons);
      setButtons(nextButtons);
      setSheetOpen(false);
      await refreshConfig();

      toast({
        title: "Configuration saved",
        description: `Button ${selectedButton.id} now uses ${finalSoundFile}`,
      });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const stopButtonPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }

    setActivePreviewButtonId(null);
  };

  const previewButtonSound = (button: ButtonConfig) => {
    if (!button.audioUrl) {
      toast({
        title: "No sound assigned",
        description: `Button ${button.id} does not have a sound yet.`,
      });
      return;
    }

    if (activePreviewButtonId === button.id && previewAudioRef.current) {
      stopButtonPreview();
      return;
    }

    stopButtonPreview();

    const audio = new Audio(button.audioUrl);
    previewAudioRef.current = audio;
    setActivePreviewButtonId(button.id);

    audio.onended = () => {
      previewAudioRef.current = null;
      setActivePreviewButtonId(null);
    };

    audio.play().catch((error) => {
      previewAudioRef.current = null;
      setActivePreviewButtonId(null);

      toast({
        title: "Preview failed",
        description: error instanceof Error ? error.message : "Could not play this sound.",
        variant: "destructive",
      });
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Device Configuration</h1>
          <p className="text-muted-foreground mt-1">
            Assign sounds to each button. Each owner&apos;s setup is saved separately.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={handleShuffleButtonSounds}>
          <Shuffle className="h-4 w-4 mr-2" />
          Shuffle sounds
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Parrot Device</CardTitle>
        </CardHeader>

        <CardContent>
          <div className="flex justify-center">
            <div className="relative bg-muted border-2 border-border rounded-2xl w-72 h-80 flex flex-col items-center justify-center gap-4 p-6 shadow-sm">
              <span className="absolute top-4 left-4 text-[10px] font-medium text-muted-foreground tracking-widest uppercase">
                Parrot Device
              </span>

              <div className="grid grid-cols-2 gap-4 mt-4">
                {buttons.map((btn) => (
                  <button
                    key={btn.id}
                    onClick={() => previewButtonSound(btn)}
                    onDoubleClick={() => openConfig(btn)}
                    title="Click to preview sound. Click again to stop. Double-click to configure."
                    className="w-24 h-24 rounded-xl border-2 border-border transition-all duration-150 hover:scale-105 hover:shadow-md flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95"
                    style={{
                      backgroundColor: btn.color,
                      outline: activePreviewButtonId === btn.id ? "3px solid hsl(45, 100%, 60%)" : "none",
                    }}
                  >
                    <Music className="h-5 w-5 text-white/90" />
                    <span className="text-[10px] text-white/80 font-medium">Button {btn.id}</span>
                    <span className="text-[9px] text-white/70 px-1 truncate max-w-20">
                      {activePreviewButtonId === btn.id ? "playing..." : btn.songName || "empty"}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex gap-1 mt-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="w-1 h-3 bg-border rounded-full" />
                ))}
              </div>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Click a button to preview playback. Click the same button again to stop. Double-click a button to assign a sound.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            {buttons.map((btn) => (
              <div key={btn.id} className="text-center space-y-2">
                <div className="w-4 h-4 rounded-full mx-auto" style={{ backgroundColor: btn.color }} />
                <p className="text-sm font-medium">Button {btn.id}</p>
                <p className="text-xs text-muted-foreground truncate">{btn.soundFile || "No sound assigned"}</p>
                <Button variant="outline" size="sm" onClick={() => openConfig(btn)}>
                  Configure
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto max-h-screen">
          <SheetHeader>
            <SheetTitle>Configure Button {selectedButton?.id}</SheetTitle>
            <SheetDescription>
              Choose an existing sound or upload a new WAV/MP3 file. Files must be maximum 2 minutes.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 mt-6 pb-8">
            <div className="space-y-2">
              <Label>Sound description / label</Label>
              <Input
                value={tempSongName}
                onChange={(e) => setTempSongName(e.target.value)}
                placeholder="Example: calm piano, short bell, bird chirping..."
              />
              <p className="text-xs text-muted-foreground">
                This description will be saved in metadata and shown in the dashboard.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Existing sound file</Label>
              <Select value={tempSoundFile} onValueChange={handleSoundSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select sound from device library" />
                </SelectTrigger>
                <SelectContent>
                  {sounds.map((sound) => (
                    <SelectItem key={sound.name} value={sound.name}>
                      {sound.label || sound.name} ({sound.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Or upload new audio</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,audio/mpeg,audio/wav"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                {tempUploadFile ? (
                  <div className="flex items-center gap-2 justify-center">
                    <Music className="h-4 w-4 text-primary" />
                    <span className="text-sm truncate">{tempUploadFile.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setTempUploadFile(null);
                        setTempUploadDurationMs(null);
                        setTempAudioUrl(tempSoundFile ? getSoundUrl(tempSoundFile) : null);
                      }}
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload MP3 or WAV
                  </Button>
                )}
              </div>
            </div>

            {tempAudioUrl && (
              <div className="space-y-2">
                <Label>Preview</Label>
                <div className="flex items-center gap-3 bg-muted rounded-lg p-3">
                  <Button variant="ghost" size="icon" onClick={togglePlay} className="shrink-0">
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <audio ref={audioRef} src={tempAudioUrl} onEnded={() => setIsPlaying(false)} />
                  <span className="text-sm text-muted-foreground truncate">
                    {tempSongName || tempSoundFile || "Untitled"}
                  </span>
                </div>
              </div>
            )}

            <Button className="w-full" onClick={handleSave} disabled={!tempSoundFile && !tempUploadFile}>
              <Save className="h-4 w-4 mr-2" />
              Save to my device config
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}