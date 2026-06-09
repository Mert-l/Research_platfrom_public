import { useEffect, useRef, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

const PHOTO_BUCKET = "parrot-photos";

const emptyProfile = {
  ownerName: "",
  email: "",
  parrotName: "",
  species: "",
  age: "",
  gender: "",
  environment: "",
  parrotPhotoUrl: "",
};

export default function Profile() {
  const { toast } = useToast();

  const [profile, setProfile] = useState(emptyProfile);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");

  const photoInputRef = useRef<HTMLInputElement>(null);

  const update = (key: string, value: string) => {
    setProfile((previous) => ({ ...previous, [key]: value }));
  };

  const loadProfileByEmail = async (email: string) => {
    const cleanEmail = email.trim();
    if (!cleanEmail) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (error) {
      toast({
        title: "Could not load profile",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    if (!data) return;

    setProfile({
      ownerName: data.owner_name || "",
      email: data.email || cleanEmail,
      parrotName: data.parrot_name || "",
      species: data.species || "",
      age: data.age !== null && data.age !== undefined ? String(data.age) : "",
      gender: data.gender || "",
      environment: data.environment || "",
      parrotPhotoUrl: data.parrot_photo_url || "",
    });

    setPhotoFile(null);
    setPhotoPreviewUrl(data.parrot_photo_url || "");
    setAgreementAccepted(Boolean(data.agreement_accepted));
    localStorage.setItem("parrot_owner_email", data.email || cleanEmail);
  };

  useEffect(() => {
    const savedEmail = localStorage.getItem("parrot_owner_email");

    if (savedEmail) {
      setProfile((previous) => ({ ...previous, email: savedEmail }));
      loadProfileByEmail(savedEmail);
    }
  }, []);

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file",
        description: "Please upload an image file.",
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload an image smaller than 5 MB.",
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const uploadParrotPhoto = async () => {
    if (!photoFile) {
      return profile.parrotPhotoUrl;
    }

    const cleanEmail = profile.email.trim().toLowerCase();
    const extension = photoFile.name.split(".").pop() || "jpg";
    const filePath = `${cleanEmail}/parrot-photo-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(filePath, photoFile, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage
      .from(PHOTO_BUCKET)
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreviewUrl("");
    update("parrotPhotoUrl", "");

    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
  };

  const saveProfile = async () => {
    if (!profile.ownerName.trim() || !profile.email.trim() || !profile.parrotName.trim()) {
      toast({
        title: "Missing information",
        description: "Please fill in at least owner name, email, and parrot name.",
        variant: "destructive",
      });
      return;
    }

    if (!agreementAccepted) {
      setAgreementOpen(true);
      return;
    }

    setSaving(true);

    try {
      const uploadedPhotoUrl = await uploadParrotPhoto();

      const { error } = await supabase.from("profiles").upsert(
        {
          owner_name: profile.ownerName.trim(),
          email: profile.email.trim(),
          parrot_name: profile.parrotName.trim(),
          species: profile.species.trim(),
          age: profile.age ? Number(profile.age) : null,
          gender: profile.gender,
          environment: profile.environment,
          parrot_photo_url: uploadedPhotoUrl || null,
          agreement_accepted: true,
          agreement_accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      );

      if (error) {
        throw error;
      }

      localStorage.setItem("parrot_owner_email", profile.email.trim());

      setProfile((previous) => ({
        ...previous,
        parrotPhotoUrl: uploadedPhotoUrl || "",
      }));

      setPhotoFile(null);
      setPhotoPreviewUrl(uploadedPhotoUrl || "");

      toast({
        title: "Profile saved",
        description: "Your owner, parrot information, and photo have been saved.",
      });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Parrot Owner Profile</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account and parrot details.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Owner Information</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={profile.ownerName}
                onChange={(event) => update("ownerName", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={profile.email}
                onChange={(event) => update("email", event.target.value)}
                onBlur={() => loadProfileByEmail(profile.email)}
              />
              <p className="text-xs text-muted-foreground">
                If this email already exists, the existing profile will be updated.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Parrot Information</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center gap-6 mb-2">
            <div className="w-24 h-24 rounded-full bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden">
              {photoPreviewUrl ? (
                <img
                  src={photoPreviewUrl}
                  alt="Parrot"
                  className="w-full h-full object-cover"
                />
              ) : (
                <Camera className="h-6 w-6 text-muted-foreground" />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Parrot Photo</p>
              <p className="text-xs text-muted-foreground">
                Upload a photo of your parrot. Maximum file size: 5 MB.
              </p>

              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload photo
                </Button>

                {photoPreviewUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={removePhoto}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Parrot Name</Label>
              <Input
                value={profile.parrotName}
                onChange={(event) => update("parrotName", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Species</Label>
              <Input
                value={profile.species}
                onChange={(event) => update("species", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Age (years)</Label>
              <Input
                type="number"
                value={profile.age}
                onChange={(event) => update("age", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Gender</Label>
              <Select
                value={profile.gender}
                onValueChange={(value) => update("gender", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Environment</Label>
            <Select
              value={profile.environment}
              onValueChange={(value) => update("environment", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="home">Home</SelectItem>
                <SelectItem value="aviary">Aviary</SelectItem>
                <SelectItem value="research">Research Lab</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">User Agreement</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Before registering, please open and read the user agreement.
          </p>

          <Button variant="outline" onClick={() => setAgreementOpen(true)}>
            Read User Agreement
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={agreementAccepted}
              onCheckedChange={(checked) => setAgreementAccepted(Boolean(checked))}
            />
            <span>I have read and agree to the user agreement.</span>
          </div>
        </CardContent>
      </Card>

      <Button onClick={saveProfile} className="w-full" disabled={saving}>
        {saving ? "Saving..." : "Save Profile"}
      </Button>

      <AlertDialog open={agreementOpen} onOpenChange={setAgreementOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>User Agreement</AlertDialogTitle>

            <AlertDialogDescription asChild>
              <div className="max-h-[400px] overflow-y-auto space-y-3 text-left text-sm">
                <p>
                  This application is used as part of a research project studying
                  parrot interaction with a sound-playing device.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAgreementAccepted(true);
                setAgreementOpen(false);
              }}
            >
              I Have Read and Agree
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}