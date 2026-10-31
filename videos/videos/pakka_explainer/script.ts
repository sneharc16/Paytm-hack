// Hinglish narration for the Pakka explainer. One line per visual beat: each segment shows one step per line,
// and scripts/voiceover.ts speaks every line with Sarvam Bulbul (hi-IN) to time the beats from the real audio.
// Hindi words are in Devanagari and product words in Latin, which is how Bulbul reads code-mixed text best.
// Numbers are written as words so they are spoken the Indian way.

export const SCRIPT: Record<string, string[]> = {
	"pakka-cold-open": [
		"हर महीने, लाखों लोगों के पैसे AutoPay से अपने आप कटते हैं।",
		"कभी free trial ख़त्म होने के बाद, कभी ऐसे plan के लिए जो अब कोई use ही नहीं करता।",
		"Pakka एक भरोसे की परत है, जो पैसा कटने से पहले, आपसे पूछती है।",
	],
	"pakka-problem": [
		"Problem simple है। AutoPay लगाना आसान है, पर उसे रोकना बहुत मुश्किल।",
		"Trial के बाद अचानक पूरा charge। और reminder आता भी है, तो ग़लत भाषा में, ग़लत समय पर।",
		"पैसा कट गया, तो refund के लिए हफ़्तों की भाग दौड़।",
		"और merchant का भी नुकसान। Failed retries, complaints, और users का टूटा हुआ भरोसा।",
	],
	"pakka-how-it-works": [
		"Pakka हर charge से पहले, आपकी अपनी भाषा में, एक साफ़ reminder भेजता है।",
		"फिर चार options, बराबर वज़न के। रखो, skip करो, pause करो, या cancel करो। कोई option पहले से चुना नहीं होता।",
		"Skip के लिए PIN की ज़रूरत नहीं। Pause और cancel को passkey से पक्का किया जाता है।",
		"और पैसे का हर move, एक gateway से होकर जाता है, जिस पर एक rule ID लगी होती है। बिना rule के, एक रुपया भी नहीं हिलता।",
	],
	"pakka-sunita": [
		"मिलिए Sunita से। उनका trial ख़त्म होने वाला है, और Pakka का reminder आ चुका है।",
		"वो decision sheet खोलती हैं। चारों options सामने हैं, बराबर, और कुछ भी पहले से चुना नहीं गया।",
		"Passkey से confirm किया, और AutoPay रुक गया। एक भी रुपया नहीं कटा।",
		"और अगर बस इस महीने का charge रोकना हो, तो Sunita बोल सकती हैं, इस महीने skip करो। कोई PIN नहीं।",
	],
	"pakka-rules": [
		"Charge का समय भी सोच समझ कर। सुबह दस से दोपहर एक, और शाम पाँच से रात साढ़े नौ, कोई charge या retry नहीं।",
		"एक cycle में ज़्यादा से ज़्यादा चार attempts। इसलिए Rahul का retry, रात साढ़े नौ के बाद ही होगा।",
		"हर फ़ैसले के साथ उसकी rule ID जुड़ी रहती है, ताकि बाद में पूरा हिसाब मिल सके।",
	],
	"pakka-languages": [
		"Pakka चौबीस भारतीय भाषाओं में बात करता है। हिंदी, Hinglish, तमिल, बांग्ला, मराठी, और भी बहुत सी।",
		"Reminders Sarvam AI live लिखता है, और हर line को असली facts से check किया जाता है।",
		"AI कभी पैसे का फ़ैसला नहीं करता। Check fail हुआ, तो तैयार template काम आता है। और सुनें दबाकर, आप reminder सुन भी सकते हैं।",
	],
	"pakka-live": [
		"और ये सब live चलता है। Passkey से sign up, कोई password नहीं।",
		"Bank का SMS paste कीजिए, और Pakka ख़ुद पहचान लेता है कि कौन सा AutoPay है।",
		"सिर्फ़ पैसा simulated है। लोग, passkeys, AutoPays और reminders, सब असली चलते हैं।",
	],
	"pakka-merchant": [
		"अब merchant की तरफ़ से देखते हैं। Pakka ने एक लाख उनसठ हज़ार रुपये के अनचाहे charges रोके।",
		"और फिर भी merchant के लिए पचपन हज़ार रुपये collect हुए, क्योंकि लोगों ने ख़ुद हाँ कहा।",
		"तेरह सौ mandates check हुए, और तीन सौ अठारह लोगों ने ख़ुद अपना फ़ैसला चुना।",
		"Review Radar ने छियालीस complaints पकड़ीं, और PadhoAI ने, हाँ के बाद ही charge, वाला setting चालू कर दिया।",
	],
	"pakka-business": [
		"अब मिलिए Pakka for Business से। यहाँ companies अपने vendor payouts AI agents से चलाती हैं।",
		"पर यहाँ agents पैसा हिला ही नहीं सकते। वो सिर्फ़ propose करते हैं।",
		"हर payout पर तीन agent signatures, लोगों की passkeys, और अट्ठाईस guard checks।",
		"पचास हज़ार रुपये से बड़ा payout, checker की passkey के बिना कभी नहीं निकलता।",
	],
	"pakka-phishing": [
		"एक phishing email आता है, नए bank details के साथ। Agents invoice भेजते हैं, और guard उसे वहीं रोक देता है।",
		"Email वाले bank details एक change request बन जाते हैं, जो maker की screen पर दिखती है।",
		"Maker file पर रखे number पर call करता है। Vendor कहता है, हमने तो कभी नहीं माँगा।",
		"असली invoice, असली account में, checker की passkey के बाद ही pay होता है।",
		"हमारी red team ने बारह attacks किए। एक भी पार नहीं हुआ।",
	],
	"pakka-developers": [
		"Developers के लिए एक Python SDK है। Passkey से sign कीजिए, और API key सिर्फ़ एक बार दिखती है।",
		"हर request, agent की अपनी key से signed होती है। बस कुछ lines, और आपका agent तैयार।",
		"Webhooks verify होते हैं, और हर event का पूरा audit trail रहता है।",
	],
	"pakka-proof": [
		"दो सौ छह unit tests, चौबीस Python tests, और उनतालीस steps का screenshot tour। सब pass।",
		"और एक भी पैसा, बिना rule के नहीं हिला।",
	],
	"pakka-outro": [
		"Pakka। हर AutoPay, आपकी मर्ज़ी से।",
		"शुक्रिया।",
	],
};

export const ORDER = Object.keys(SCRIPT);
