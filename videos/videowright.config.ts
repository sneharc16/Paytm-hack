import { defineConfig } from "videowright";

export default defineConfig({
	projectStructure: "v1",
	defaultStyle: "pakka",
	defaults: { resolution: [1920, 1080], fps: 30, aspectRatio: "16:9" },
});
