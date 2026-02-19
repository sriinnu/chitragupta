import type { CheckinSubtype, TaskType } from "./router-task-type.js";

export interface TypeSignal {
	type: TaskType;
	weight: number;
	label: string;
	test: (text: string, wordCount: number, hasTools: boolean, hasImages: boolean) => boolean;
}

// Patterns grouped by task type
const EMBEDDING_PATTERNS = /\b(embed|embedding|vector|vectorize|encode|encode\s+text|similarity|semantic\s+search|nearest\s+neighbor|cosine)\b/i;
const SEARCH_PATTERNS = /\b(search|find|look\s+up|retrieve|query|where\s+is|locate|grep|list\s+all|show\s+me\s+all|BM25|full.?text)\b/i;
const VISION_PATTERNS = /\b(image|screenshot|picture|photo|visual|pixel|diagram|render|draw|chart|look\s+at\s+this|what\s+do\s+you\s+see|describe\s+this\s+image)\b/i;
const CODE_PATTERNS = /\b(function|class|import|export|implement|code|write\s+a|create\s+a|debug|fix\s+the\s+bug|refactor|compile|typescript|python|javascript|rust|go|api\s+endpoint|unit\s+test|test\s+for)\b/i;
const REASONING_PATTERNS = /\b(analyze|compare|evaluate|design|trade-?offs?|pros?\s+and\s+cons?|architecture|investigate|explain\s+why|how\s+does|should\s+we|recommend|strategy|approach|plan|review)\b/i;
const SUMMARIZE_PATTERNS = /\b(summarize|summary|tldr|tl;dr|condense|compress|key\s+points|brief|overview|recap|digest|extract\s+the)\b/i;
const TRANSLATE_PATTERNS = /\b(translate|translation|in\s+spanish|in\s+french|in\s+german|in\s+hindi|in\s+japanese|to\s+english|from\s+english|localize|i18n)\b/i;
const HEARTBEAT_PATTERNS = /^(ping|health|status|alive|heartbeat|are\s+you\s+there)\s*[\?\!]?\s*$/i;
const SMALLTALK_PATTERNS = /\b(hi|hello|hey|hii+|heyy+|yo|sup|wassup|hru|how\s+(?:are|r)\s+(?:you|u)|how(?:'s|\s+is)\s+it\s+going|hola|bonjour|hallo|ciao|ola|namaste|namaskar(?:am|a)?|vanakkam|merhaba|nasilsin|nasilsiniz|kaise\s+ho|kya\s+haal(?:\s+hai)?|como\s+estas|que\s+tal|comment\s+ca\s+va|comment\s+allez(?:[-\s]+vous)?|ca\s+va|wie\s+geht(?:s|es)(?:\s+dir)?|tudo\s+bem|bagunava|bagunnava|bagunnara|ela\s+undh?i|ela\s+unnav(?:u)?|ela\s+unnaru|all\s+good(?:\s+ha)?|thanks?|thank\s*you|thx|gracias|danke|merci|dhanyavad(?:alu)?|shukriya|vale|de\s+acuerdo|compris|entendu|alles\s+klar|in\s+ordnung|verstanden|theek\s+hai|anladim|tamam|ok(?:ay)?|ack)\b/i;
const SMALLTALK_SCRIPT_PATTERNS = /(привет|здравствуйте|как\s+дела|спасибо|مرحبا|السلام\s+عليكم|كيف\s+حالك|شكرا|你好|你好吗|谢谢|こんにちは|お元気ですか|ありがとう|안녕하세요|잘\s*지내세요|감사합니다|नमस्ते|धन्यवाद|నమస్తే|హలో|హాయ్)/u;
const SMALLTALK_ACTION_GUARD = /\b(weather|forecast|clima|tiempo|wetter|pogoda|meteo|rain|snow|temperature|temp|router|network|wifi|device|client|connected|lan|scan|time|clock|remind|note|notes|search|find|nearest|hospital|train|rail|journey|memory|session|provider|model|set|delete|forget|clear|music|play|transcrib|calendar|event|todo|inbox|email|emails|mail|gmail|joke|funny|meme|story|poem|quote|news|latest|top|tell\s+me|who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|run|execute|install|debug|code|review|translate|translation|localize|i18n|summarize|summary|tldr|tl;dr|condense|compress)\b/i;
const SMALLTALK_ACK_PATTERNS = /\b(thanks?|thank\s*you|thx|gracias|danke|merci|dhanyavad(?:alu)?|shukriya|vale|de\s+acuerdo|compris|entendu|alles\s+klar|in\s+ordnung|verstanden|theek\s+hai|anladim|tamam|ok(?:ay)?|ack)\b/i;
const SMALLTALK_CHECKIN_PATTERNS = /\b(hru|how\s+(?:are|r)\s+(?:you|u)|how(?:'s|\s+is)\s+it\s+going|all\s+good(?:\s+ha)?|kaise\s+ho|kya\s+haal(?:\s+hai)?|como\s+estas|que\s+tal|comment\s+ca\s+va|comment\s+allez(?:[-\s]+vous)?|ca\s+va|wie\s+geht(?:s|es)(?:\s+dir)?|tudo\s+bem|bagunava|bagunnava|bagunnara|ela\s+undh?i|ela\s+unnav(?:u)?|ela\s+unnaru|nasilsin|nasilsiniz|как\s+дела|كيف\s+حالك|你好吗|お元気ですか|잘\s*지내세요)\b/i;
const TOOL_PATTERNS = /\b(run\s+the|execute|call|invoke|use\s+the\s+tool|bash|shell|terminal|command|mkdir|npm|git|pip|docker)\b/i;
const MEMORY_PATTERNS = /\b(remember|recall|what\s+did\s+(i|we)|last\s+session|previous\s+conversation|my\s+preference|session\s+history|show\s+memory|list\s+sessions|search\s+sessions|what\s+do\s+you\s+know\s+about\s+me)\b/i;
const FILE_OP_PATTERNS = /\b(read\s+file|write\s+file|list\s+files|show\s+files|cat\s+|head\s+|tail\s+|ls\s+|find\s+files|grep\s+for|open\s+file|create\s+file|delete\s+file|rename\s+file|move\s+file|copy\s+file)\b/i;
const API_CALL_PATTERNS = /\b(get\s+(my\s+)?emails?|check\s+(my\s+)?inbox|send\s+(an?\s+)?email|slack\s+message|post\s+to|fetch\s+from|api\s+call|webhook|calendar|schedule|reminder|notification)\b/i;
const COMPACTION_PATTERNS = /\b(compact|compaction|token\s+budget|sinkhorn|allocat|context\s+window|trim\s+context|reduce\s+context|free\s+up\s+tokens)\b/i;

export const TYPE_SIGNALS: TypeSignal[] = [
	{
		type: "heartbeat",
		weight: 10,
		label: "heartbeat/ping pattern",
		test: (text) => HEARTBEAT_PATTERNS.test(text.trim()),
	},
	{
		type: "smalltalk",
		weight: 9,
		label: "smalltalk greeting/checkin",
		test: (text, wordCount) =>
			wordCount <= 10 &&
			!SMALLTALK_ACTION_GUARD.test(text) &&
			(SMALLTALK_PATTERNS.test(text) || SMALLTALK_SCRIPT_PATTERNS.test(text)),
	},
	{
		type: "embedding",
		weight: 8,
		label: "embedding/vector keywords",
		test: (text) => EMBEDDING_PATTERNS.test(text),
	},
	{
		type: "vision",
		weight: 7,
		label: "image/visual content",
		test: (_text, _wc, _hasTools, hasImages) => hasImages,
	},
	{
		type: "vision",
		weight: 5,
		label: "vision keywords",
		test: (text) => VISION_PATTERNS.test(text),
	},
	{
		type: "search",
		weight: 6,
		label: "search/retrieval keywords",
		test: (text) => SEARCH_PATTERNS.test(text),
	},
	{
		type: "tool-exec",
		weight: 5,
		label: "tool/command execution",
		test: (text, _wc, hasTools) => hasTools && TOOL_PATTERNS.test(text),
	},
	{
		type: "code-gen",
		weight: 5,
		label: "code generation keywords",
		test: (text) => CODE_PATTERNS.test(text),
	},
	{
		type: "summarize",
		weight: 5,
		label: "summarization keywords",
		test: (text) => SUMMARIZE_PATTERNS.test(text),
	},
	{
		type: "translate",
		weight: 5,
		label: "translation keywords",
		test: (text) => TRANSLATE_PATTERNS.test(text),
	},
	{
		type: "memory",
		weight: 7,
		label: "memory/session recall",
		test: (text) => MEMORY_PATTERNS.test(text),
	},
	{
		type: "file-op",
		weight: 7,
		label: "file read/write/list",
		test: (text) => FILE_OP_PATTERNS.test(text),
	},
	{
		type: "api-call",
		weight: 7,
		label: "external API call (email, slack, etc.)",
		test: (text) => API_CALL_PATTERNS.test(text),
	},
	{
		type: "compaction",
		weight: 8,
		label: "context compaction / budget allocation",
		test: (text) => COMPACTION_PATTERNS.test(text),
	},
	{
		type: "reasoning",
		weight: 4,
		label: "reasoning/analysis keywords",
		test: (text) => REASONING_PATTERNS.test(text),
	},
	{
		type: "chat",
		weight: 1,
		label: "general conversation",
		test: () => true,
	},
];

export function detectCheckinSubtype(text: string, type: TaskType): CheckinSubtype {
	if (type === "heartbeat") return "checkin";
	if (SMALLTALK_CHECKIN_PATTERNS.test(text)) return "checkin";
	if (SMALLTALK_ACK_PATTERNS.test(text)) return "ack";
	return "greeting";
}
