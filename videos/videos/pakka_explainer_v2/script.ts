// Hinglish narration for the updated Pakka explainer (main at 389e6c8). Scenes that are still true are reused with
// their original lines from pakka_explainer; the pakka2-* scenes cover what the latest code added: privacy masking,
// the three-agent review, the review trail, the new language and voice setup, and the new test counts.
// Same rules as v1: Hindi in Devanagari, product words in Latin, numbers as words.
import { SCRIPT as V1 } from "../pakka_explainer/script";

const NEW: Record<string, string[]> = {
	"pakka2-privacy": [
		"अब बात privacy की। Customer का phone number, UPI ID, account या OTP, AI model तक कभी नहीं पहुँचते।",
		"Pakka पहले हर value को एक token में बदल देता है, जैसे PHONE एक। Model सिर्फ़ tokens देखता है, असली values हमारे पास ही रहती हैं।",
		"OTP और PIN तो वापस भी नहीं खुलते। और masking fail हुई, तो model को कुछ भेजा ही नहीं जाता।",
	],
	"pakka2-review": [
		"और AI का हर message, जो कोई इंसान पढ़ेगा, तीन agents से होकर गुज़रता है।",
		"एक writer draft लिखता है। एक अलग reviewer उसे ग्यारह rules पर जाँचता है। Facts, भाषा, length, privacy, और कोई option आगे न धकेलना।",
		"Code के checks पहले चलते हैं। जो check code ने fail किया, उसे reviewer भी pass नहीं कर सकता।",
		"पाँच rounds में बात न बने, तो consolidator reviewer का फ़ैसला लागू करता है। फिर भी fail हुआ, तो हाथ से लिखा template जाता है।",
	],
	"pakka2-trail": [
		"हर message का पूरा review trail, control room में दिखता है।",
		"जैसे Sunita का Hindi reminder। पहले round में script check fail हुआ, सिर्फ़ छप्पन percent देवनागरी। दूसरे round में ग्यारह के ग्यारह rules pass।",
		"पूरी कहानी में छह सौ नौ AI messages, दूसरे agent ने check किए, औसतन डेढ़ round में।",
	],
	"pakka2-languages": [
		"Pakka चौबीस भारतीय भाषाओं में बात करता है। हिंदी, Hinglish और English हाथ से लिखे गए, बाकी इक्कीस Sarvam AI translate करता है, और हर line check होती है।",
		"सुनें दबाइए, और reminder Bulbul की आवाज़ में सुनिए। Mic से सवाल पूछिए, Pakka तेईस भाषाएँ समझता है।",
		"पर जिस script में personal data हो, वो कभी बोली नहीं जाती। और AI कभी पैसे का फ़ैसला नहीं करता।",
	],
	"pakka2-proof": [
		"दो सौ सत्तर unit tests, चौबीस Python tests, और उनतालीस steps का screenshot tour। सब pass।",
		"हर AI text masked और reviewed। और एक भी पैसा, बिना rule के नहीं हिला।",
	],
};

const ORDER_V2 = [
	"pakka-cold-open",
	"pakka-problem",
	"pakka-how-it-works",
	"pakka-sunita",
	"pakka-rules",
	"pakka2-privacy",
	"pakka2-review",
	"pakka2-trail",
	"pakka2-languages",
	"pakka-live",
	"pakka-merchant",
	"pakka-business",
	"pakka-phishing",
	"pakka-developers",
	"pakka2-proof",
	"pakka-outro",
];

export const SCRIPT: Record<string, string[]> = Object.fromEntries(ORDER_V2.map((id) => [id, NEW[id] ?? V1[id]]));
export const ORDER = ORDER_V2;
/** Lines for the scenes this video adds; scene() reads these alongside v1's. */
export const NEW_SCRIPT = NEW;
