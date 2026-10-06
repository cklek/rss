import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { DialogProvider } from "@/shell/dialog";
import ReaderPage from "@/app";
import { useTheme } from "@/lib/theme";

function ThemedToaster() {
  const theme = useTheme();
  return (
    <Toaster theme={theme.dark ? "dark" : "light"} position="bottom-right" />
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <DialogProvider>
      <ReaderPage />
      <ThemedToaster />
    </DialogProvider>
  </StrictMode>,
);
