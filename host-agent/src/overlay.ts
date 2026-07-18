import { emit } from "@tauri-apps/api/event";

const disconnectBtn = document.querySelector<HTMLButtonElement>("#disconnectBtn")!;

disconnectBtn.addEventListener("click", async () => {
  disconnectBtn.disabled = true;
  disconnectBtn.textContent = "Disconnecting…";
  try {
    await emit("deskly-host-disconnect");
  } catch (err) {
    console.error(err);
    disconnectBtn.disabled = false;
    disconnectBtn.textContent = "Disconnect";
  }
});
