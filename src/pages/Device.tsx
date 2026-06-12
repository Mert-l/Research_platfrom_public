import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Music,
  Pause,
  Play,
  Save,
  Shuffle,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

const SOUND_BUCKET = "parrot-sounds";
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface SoundFile {
  id?: string;
  owner_email: string;
  name: string;
  label?: string;
  duration_ms?: number | null;
  file_path: string;
  public_url: string;
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

const MAX_AUDIO_SECONDS = 120;

const allowedAudioTypes = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
];

const allowedAudioExtensions = [".mp3", ".wav"];

function getCurrentOwnerEmail() {
  return String(localStorage.getItem("parrot_owner_email") || "")
    .trim()
    .toLowerCase();
}

function displaySoundLabel(sound?: SoundFile | null) {
  if (!sound) return "";
  return sound.label || sound.name?.replace(/\.[^.]+$/, "") || "Untitled";
}

function shuffleArray<T>(items: T[]) {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
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

  return (
    allowedAudioTypes.includes(file.type) ||
    allowedAudioExtensions.some((ext) => lowerName.endsWith(ext))
  );
}

export default function Device() {
  const { toast } = useToast();

  const [ownerEmail, setOwnerEmail] = useState(getCurrentOwnerEmail());
  const [buttons, setButtons] = useState<ButtonConfig[]>(emptyButtons);
  const [sounds, setSounds] = useState<SoundFile[]>([]);
  const [selectedButton, setSelectedButton] = useState<ButtonConfig | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tempSongName, setTempSongName] = useState("");
  const [tempSoundFile, setTempSoundFile] = useState("");
  const [tempUploadFile, setTempUploadFile] = useState<File | null>(null);
  const [tempUploadDurationMs, setTempUploadDurationMs] = useState<number | null>(
    null
  );
  const [tempAudioUrl, setTempAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activePreviewButtonId, setActivePreviewButtonId] = useState<
    number | null
  >(null);
  const [soundToDelete, setSoundToDelete] = useState<SoundFile | null>(null);
  const [deletingSound, setDeletingSound] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasOwnerProfile = Boolean(ownerEmail);

  const soundByPath = useMemo(() => {
    const map = new Map<string, SoundFile>();
    sounds.forEach((sound) => {
      map.set(sound.file_path, sound);
    });
    return map;
  }, [sounds]);

  const buildButtonsFromConfig = (
    config: Record<string, string>,
    soundMap: Map<string, SoundFile>
  ) => {
    return [1, 2, 3, 4].map((id) => {
      const soundFile = config[String(id)] || "";
      const sound = soundMap.get(soundFile);

      return {
        id,
        color: buttonColors[id],
        label: String(id),
        songName:
          displaySoundLabel(sound) || soundFile.replace(/\.[^.]+$/, ""),
        soundFile,
        audioUrl: sound?.public_url || null,
      };
    });
  };

  const loadSounds = async (email: string) => {
    const { data, error } = await supabase
      .from("sound_files")
      .select("*")
      .eq("owner_email", email)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (data || []) as SoundFile[];
  };

  const loadUserConfig = async (email: string) => {
    const { data, error } = await supabase
      .from("device_configs")
      .select("buttons")
      .eq("owner_email", email)
      .maybeSingle();

    if (error) throw error;

    return data?.buttons || { "1": "", "2": "", "3": "", "4": "" };
  };

  const refreshConfig = async () => {
    const email = getCurrentOwnerEmail();
    setOwnerEmail(email);

    if (!email) {
      setSounds([]);
      setButtons(emptyButtons);
      return;
    }

    try {
      const loadedSounds = await loadSounds(email);
      const loadedSoundMap = new Map<string, SoundFile>();

      loadedSounds.forEach((sound) => {
        loadedSoundMap.set(sound.file_path, sound);
      });

      const config = await loadUserConfig(email);

      setSounds(loadedSounds);
      setButtons(buildButtonsFromConfig(config, loadedSoundMap));
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
    setButtons((previous) =>
      previous.map((button) => {
        const sound = soundByPath.get(button.soundFile);

        return {
          ...button,
          songName: displaySoundLabel(sound) || button.songName,
          audioUrl: sound?.public_url || button.audioUrl,
        };
      })
    );
  }, [soundByPath]);

  const openConfig = (button: ButtonConfig) => {
    if (!hasOwnerProfile) {
      toast({
        title: "Create or log in to a profile first",
        description:
          "A profile is needed so uploaded sounds and button settings can be saved to the right owner.",
      });
      return;
    }

    setSelectedButton(button);
    setTempSongName(button.songName);
    setTempSoundFile(button.soundFile);
    setTempUploadFile(null);
    setTempUploadDurationMs(null);
    setTempAudioUrl(button.audioUrl);
    setIsPlaying(false);
    setSheetOpen(true);
  };

  const handleSoundSelect = (filePath: string) => {
    const sound = soundByPath.get(filePath);

    setTempSoundFile(filePath);
    setTempUploadFile(null);
    setTempUploadDurationMs(null);
    setTempSongName(displaySoundLabel(sound));
    setTempAudioUrl(sound?.public_url || null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isAllowedAudioFile(file)) {
      toast({
        title: "Invalid file",
        description: "Only MP3 and WAV files are allowed.",
        variant: "destructive",
      });
      event.target.value = "";
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
        event.target.value = "";
        return;
      }

      setTempUploadFile(file);
      setTempUploadDurationMs(Math.round(durationSeconds * 1000));
      setTempSoundFile(file.name);
      setTempSongName(
        (current) => current.trim() || file.name.replace(/\.[^.]+$/, "")
      );
      setTempAudioUrl(URL.createObjectURL(file));
    } catch (error) {
      toast({
        title: "Upload failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not read this audio file.",
        variant: "destructive",
      });
      event.target.value = "";
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }

    setIsPlaying(!isPlaying);
  };

  const saveMappingToSupabase = async (nextButtons: ButtonConfig[]) => {
    if (!ownerEmail) {
      throw new Error("No owner email found. Please save an owner profile first.");
    }

    const payload = {
      owner_email: ownerEmail,
      buttons: Object.fromEntries(
        nextButtons.map((button) => [String(button.id), button.soundFile])
      ),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("device_configs")
      .upsert(payload, { onConflict: "owner_email" });

    if (error) throw error;
  };

  const uploadSoundToSupabase = async () => {
    if (!ownerEmail) {
      throw new Error("No owner email found. Please save or log in first.");
    }

    if (!tempUploadFile) {
      throw new Error("No audio file selected.");
    }

    const cleanFileName = tempUploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${ownerEmail}/${Date.now()}-${cleanFileName}`;
    const label = tempSongName.trim() || cleanFileName.replace(/\.[^.]+$/, "");

    const { error: uploadError } = await supabase.storage
      .from(SOUND_BUCKET)
      .upload(filePath, tempUploadFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: tempUploadFile.type || undefined,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from(SOUND_BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = publicUrlData.publicUrl;

    const { data, error } = await supabase
      .from("sound_files")
      .insert({
        owner_email: ownerEmail,
        name: cleanFileName,
        label,
        duration_ms: tempUploadDurationMs,
        file_path: filePath,
        public_url: publicUrl,
      })
      .select()
      .single();

    if (error) throw error;

    return data as SoundFile;
  };

  const handleShuffleButtonSounds = async () => {
    if (!hasOwnerProfile) {
      toast({
        title: "Create or log in to a profile first",
        description: "Shuffling has to be saved to an owner profile.",
      });
      return;
    }

    const assignedButtons = buttons.filter((button) => button.soundFile);

    if (assignedButtons.length < 2) {
      toast({
        title: "Not enough sounds to shuffle",
        description: "Assign sounds to at least 2 buttons first.",
        variant: "destructive",
      });
      return;
    }

    try {
      let shuffledAssignments = shuffleArray(
        assignedButtons.map((button) => ({
          originalButtonId: button.id,
          soundFile: button.soundFile,
          songName: button.songName,
          audioUrl: button.audioUrl,
        }))
      );

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const changedSomething = shuffledAssignments.some(
          (assignment, index) =>
            assignment.soundFile !== assignedButtons[index].soundFile
        );

        if (changedSomething) break;
        shuffledAssignments = shuffleArray(shuffledAssignments);
      }

      const shuffledByButtonId = new Map(
        assignedButtons.map((button, index) => [button.id, shuffledAssignments[index]])
      );

      const nextButtons = buttons.map((button) => {
        const nextSound = shuffledByButtonId.get(button.id);

        if (!nextSound) return button;

        return {
          ...button,
          soundFile: nextSound.soundFile,
          songName: nextSound.songName,
          audioUrl: nextSound.audioUrl,
        };
      });

      await saveMappingToSupabase(nextButtons);
      setButtons(nextButtons);

      toast({
        title: "Sounds shuffled",
        description:
          "Assigned button sounds were shuffled. Empty buttons were left empty.",
      });
    } catch (error) {
      toast({
        title: "Shuffle failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleClearButton = async () => {
    if (!selectedButton) return;

    try {
      const nextButtons = buttons.map((button) =>
        button.id === selectedButton.id
          ? { ...button, songName: "", soundFile: "", audioUrl: null }
          : button
      );

      await saveMappingToSupabase(nextButtons);
      setButtons(nextButtons);
      setSheetOpen(false);

      toast({
        title: "Button cleared",
        description: `Button ${selectedButton.id} no longer has a sound assigned.`,
      });
    } catch (error) {
      toast({
        title: "Could not clear button",
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
      let finalAudioUrl = tempAudioUrl;

      if (tempUploadFile) {
        const uploadedSound = await uploadSoundToSupabase();

        finalSoundFile = uploadedSound.file_path;
        finalLabel = displaySoundLabel(uploadedSound);
        finalAudioUrl = uploadedSound.public_url;

        setSounds((previous) => [uploadedSound, ...previous]);
      } else {
        const existingSound = soundByPath.get(tempSoundFile);

        if (existingSound) {
          finalSoundFile = existingSound.file_path;
          finalLabel = displaySoundLabel(existingSound);
          finalAudioUrl = existingSound.public_url;
        }
      }

      const nextButtons = buttons.map((button) =>
        button.id === selectedButton.id
          ? {
              ...button,
              songName: finalLabel,
              soundFile: finalSoundFile,
              audioUrl: finalAudioUrl,
            }
          : button
      );

      await saveMappingToSupabase(nextButtons);

      setButtons(nextButtons);
      setSheetOpen(false);
      setTempUploadFile(null);
      setTempUploadDurationMs(null);

      await refreshConfig();

      toast({
        title: "Configuration saved",
        description: `Button ${selectedButton.id} now uses ${finalLabel}`,
      });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSound = async () => {
    if (!soundToDelete || !ownerEmail) return;

    setDeletingSound(true);

    try {
      const response = await fetch(`${API_BASE}/api/sounds/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          owner_email: ownerEmail,
          file_path: soundToDelete.file_path,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not delete sound");
      }

      setSounds((previous) =>
        previous.filter((sound) => sound.file_path !== soundToDelete.file_path)
      );

      setButtons((previous) =>
        previous.map((button) =>
          button.soundFile === soundToDelete.file_path
            ? { ...button, soundFile: "", songName: "", audioUrl: null }
            : button
        )
      );

      if (tempSoundFile === soundToDelete.file_path) {
        setTempSoundFile("");
        setTempSongName("");
        setTempAudioUrl(null);
      }

      toast({
        title: "Sound deleted",
        description:
          "The sound was removed from your library and cleared from any buttons that used it.",
      });

      setSoundToDelete(null);
      await refreshConfig();
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeletingSound(false);
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
        description: hasOwnerProfile
          ? `Button ${button.id} does not have a sound yet.`
          : "Create or log in to an owner profile first, then assign sounds to buttons.",
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
        description:
          error instanceof Error ? error.message : "Could not play this sound.",
        variant: "destructive",
      });
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Device Configuration
          </h1>
          <p className="text-muted-foreground mt-1">
            Assign sounds to each button. Each owner&apos;s setup is saved
            separately.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleShuffleButtonSounds}
          disabled={!hasOwnerProfile}
        >
          <Shuffle className="h-4 w-4 mr-2" />
          Shuffle assigned sounds
        </Button>
      </div>

      {!hasOwnerProfile && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6 space-y-3">
            <div>
              <p className="font-medium text-amber-950">
                Start by creating or logging in to an owner profile.
              </p>
              <p className="text-sm text-amber-900 mt-1">
                The owner profile tells the system whose sounds and button setup
                should be loaded. After that, this page will save uploads and
                button assignments to that profile.
              </p>
            </div>

            <Button asChild>
              <Link to="/profile">Go to Owner Profile / Register</Link>
            </Button>
          </CardContent>
        </Card>
      )}

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
                {buttons.map((button) => (
                  <button
                    key={button.id}
                    onClick={() => previewButtonSound(button)}
                    onDoubleClick={() => openConfig(button)}
                    title="Click to preview sound. Click again to stop. Double-click to configure."
                    className="w-24 h-24 rounded-xl border-2 border-border transition-all duration-150 hover:scale-105 hover:shadow-md flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95"
                    style={{
                      backgroundColor: button.color,
                      outline:
                        activePreviewButtonId === button.id
                          ? "3px solid hsl(45, 100%, 60%)"
                          : "none",
                    }}
                  >
                    <Music className="h-5 w-5 text-white/90" />
                    <span className="text-[10px] text-white/80 font-medium">
                      Button {button.id}
                    </span>
                    <span className="text-[9px] text-white/70 px-1 truncate max-w-20">
                      {activePreviewButtonId === button.id
                        ? "playing..."
                        : button.songName || "empty"}
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
            Click a button to preview playback. Click the same button again to
            stop. Double-click a button to assign a sound.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            {buttons.map((button) => (
              <div key={button.id} className="text-center space-y-2">
                <div
                  className="w-4 h-4 rounded-full mx-auto"
                  style={{ backgroundColor: button.color }}
                />
                <p className="text-sm font-medium">Button {button.id}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {button.songName || "No sound assigned"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openConfig(button)}
                  disabled={!hasOwnerProfile}
                >
                  Configure
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {hasOwnerProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your Sound Library</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {sounds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sounds uploaded yet. Configure a button and upload your first
                MP3 or WAV file.
              </p>
            ) : (
              sounds.map((sound) => (
                <div
                  key={sound.file_path}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {displaySoundLabel(sound)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {sound.name}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSoundToDelete(sound)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto max-h-screen">
          <SheetHeader>
            <SheetTitle>Configure Button {selectedButton?.id}</SheetTitle>
            <SheetDescription>
              Choose one of your existing sounds or upload a new WAV/MP3 file.
              Files must be maximum 2 minutes.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 mt-6 pb-8">
            <div className="space-y-2">
              <Label>Sound description / label</Label>
              <Input
                value={tempSongName}
                onChange={(event) => setTempSongName(event.target.value)}
                placeholder="Example: calm piano, short bell, bird chirping..."
              />
              <p className="text-xs text-muted-foreground">
                This label is shown on the device page instead of a confusing
                filename.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Existing sound file</Label>
              <Select
                value={soundByPath.has(tempSoundFile) ? tempSoundFile : ""}
                onValueChange={handleSoundSelect}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select from your sounds" />
                </SelectTrigger>
                <SelectContent>
                  {sounds.map((sound) => (
                    <SelectItem key={sound.file_path} value={sound.file_path}>
                      {displaySoundLabel(sound)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {sounds.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No sounds uploaded yet for this profile.
                </p>
              )}
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
                        setTempAudioUrl(
                          tempSoundFile
                            ? soundByPath.get(tempSoundFile)?.public_url || null
                            : null
                        );

                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={togglePlay}
                    className="shrink-0"
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>

                  <audio
                    ref={audioRef}
                    src={tempAudioUrl}
                    onEnded={() => setIsPlaying(false)}
                  />

                  <span className="text-sm text-muted-foreground truncate">
                    {tempSongName || "Untitled"}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={!tempSoundFile && !tempUploadFile}
              >
                <Save className="h-4 w-4 mr-2" />
                Save to my device config
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleClearButton}
                disabled={!selectedButton?.soundFile}
              >
                Clear this button
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={Boolean(soundToDelete)}
        onOpenChange={(open) => {
          if (!open) setSoundToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sound?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the sound from your library and clears it from any
              buttons that currently use it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSound}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSound}
              disabled={deletingSound}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingSound ? "Deleting..." : "Delete sound"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
