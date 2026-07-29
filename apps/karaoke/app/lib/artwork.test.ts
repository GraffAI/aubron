import { describe, expect, it } from "vitest";

import { pickItunesMatch, upsizeItunesArt } from "./artwork";

describe("pickItunesMatch", () => {
  const art = "https://a.mzstatic.com/img/x/100x100bb.jpg";

  it("prefers the hit whose artist AND title match", () => {
    const hits = [
      { artistName: "Tribute Band", trackName: "Crazy in Love", artworkUrl100: art },
      {
        artistName: "Beyoncé",
        trackName: "Crazy in Love (feat. JAY-Z)",
        artworkUrl100: art + "?right",
      },
    ];
    expect(pickItunesMatch(hits, "Beyonce", "Crazy in Love")?.artworkUrl100).toBe(art + "?right");
  });

  it("rejects results with no name overlap — wrong song entirely", () => {
    const hits = [{ artistName: "Someone Else", trackName: "Different Song", artworkUrl100: art }];
    expect(pickItunesMatch(hits, "夜に駆ける", "YOASOBI")).toBeNull();
  });

  it("ignores hits without artwork and handles empty lists", () => {
    expect(pickItunesMatch([], "a", "b")).toBeNull();
    expect(pickItunesMatch([{ artistName: "a", trackName: "b" }], "a", "b")).toBeNull();
  });

  it("matches across diacritics and punctuation", () => {
    const hits = [{ artistName: "Beyoncé", trackName: "Déjà Vu!", artworkUrl100: art }];
    expect(pickItunesMatch(hits, "beyonce", "deja vu")).not.toBeNull();
  });
});

describe("upsizeItunesArt", () => {
  it("rewrites the size segment to print quality", () => {
    expect(upsizeItunesArt("https://a.mzstatic.com/image/thumb/x/100x100bb.jpg")).toBe(
      "https://a.mzstatic.com/image/thumb/x/1200x1200bb.jpg",
    );
    expect(upsizeItunesArt("https://x/60x60.png", 3000)).toBe("https://x/3000x3000.png");
  });

  it("leaves unrecognized urls untouched", () => {
    expect(upsizeItunesArt("https://x/cover.jpg")).toBe("https://x/cover.jpg");
  });
});
