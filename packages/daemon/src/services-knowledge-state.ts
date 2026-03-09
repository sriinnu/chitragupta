import { DatabaseManager } from "@chitragupta/smriti";
import { Buddhi } from "@chitragupta/anina";

let akashaState:
	| { db: ReturnType<DatabaseManager["get"]>; akasha: import("@chitragupta/smriti").AkashaField }
	| null = null;
let buddhiState: Buddhi | null = null;

export async function getSharedAkasha() {
	const { AkashaField } = await import("@chitragupta/smriti");
	const db = DatabaseManager.instance().get("agent");
	if (!akashaState || akashaState.db !== db) {
		const akasha = new AkashaField();
		akasha.restore(db);
		akashaState = { db, akasha };
	}
	return akashaState.akasha;
}

export async function persistSharedAkasha(): Promise<void> {
	const db = DatabaseManager.instance().get("agent");
	const akasha = await getSharedAkasha();
	akasha.persist(db);
}

export function getSharedBuddhi(): Buddhi {
	if (!buddhiState) buddhiState = new Buddhi();
	return buddhiState;
}

export function resetSharedKnowledgeState(): void {
	akashaState = null;
	buddhiState = null;
}
