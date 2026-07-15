import { getSong } from "../../lib/catalog";
import { Player } from "../../player";

/**
 * Server side resolves catalog songs; session-local songs (ids like
 * "local-1") only exist in the browser, so the Player falls back to the
 * client-side store when the catalog comes up empty.
 */
export default async function SingPage({ params }: { params: Promise<{ songId: string }> }) {
  const { songId } = await params;
  const song = (await getSong(songId)) ?? null;
  return <Player song={song} songId={songId} />;
}
