import { preload } from "react-dom";

export function preloadHeroImages(desktop: string, mobile: string) {
  preload(mobile, {
    as: "image",
    fetchPriority: "high",
    media: "(max-width: 680px)",
    type: "image/webp",
  });
  preload(desktop, {
    as: "image",
    fetchPriority: "high",
    media: "(min-width: 681px)",
    type: "image/webp",
  });
}
