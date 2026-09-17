import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
import { describeEvent } from "./eventDescriptions.js";
import { loadPrefs, getLastSeenId, setLastSeenId, fireDesktopNotification, notificationPermission } from "./desktopNotifications.js";

/**
 * Mounted once at the app root (renders nothing). Polls recent events and
 * fires a real browser Notification (spec section 17) for ones matching
 * the user's enabled types — but only while this tab is open, since a
 * plain web app has no background process to notify from when it's
 * closed. That limitation is called out in the Settings page copy rather
 * than pretended away.
 */
export function DesktopNotificationWatcher() {
  const { data } = useQuery({
    queryKey: ["desktop-notification-watch"],
    queryFn: () => api.events.list(20),
    refetchInterval: 15_000,
  });
  const initialized = useRef(false);

  useEffect(() => {
    if (!data || data.length === 0) return;

    const prefs = loadPrefs();
    if (!prefs.enabled || notificationPermission() !== "granted") {
      setLastSeenId(data[0].id);
      return;
    }

    const lastSeen = getLastSeenId();
    if (!initialized.current && lastSeen === null) {
      // First run ever — set the watermark without notifying for history
      // that predates this browser turning notifications on.
      initialized.current = true;
      setLastSeenId(data[0].id);
      return;
    }
    initialized.current = true;

    const idx = lastSeen ? data.findIndex((e) => e.id === lastSeen) : -1;
    const newOnes = idx === -1 ? data : data.slice(0, idx);
    for (const evt of [...newOnes].reverse()) {
      if (prefs.types[evt.type]) {
        fireDesktopNotification(
          `${evt.platformAccount.platform.name} / ${evt.platformAccount.label}`,
          describeEvent(evt.type, evt.payload),
        );
      }
    }
    setLastSeenId(data[0].id);
  }, [data]);

  return null;
}
