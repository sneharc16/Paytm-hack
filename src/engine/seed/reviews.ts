// Hand-written review templates (PRD 10.7). Slots: {amt} {n} {brand} {legal}.
import type { Gap, Lang } from "../types";

export interface ReviewTemplate { gap: Gap; lang: Lang; low: boolean; text: string }

const t = (gap: Gap, lang: Lang, low: boolean, text: string): ReviewTemplate => ({ gap, lang, low, text });

export const TEMPLATES: ReviewTemplate[] = [
  // consent gap, low star
  t("consent", "hinglish", true, "1 rupay ka trial liya tha, {n} din baad {amt} kat gaye. kisi ne bataya hi nahi"),
  t("consent", "hinglish", true, "trial ke naam pe autopay laga diya. {amt} kat gaye bina pooche"),
  t("consent", "hinglish", true, "maine sirf 1 rs diya tha try karne ke liye, ab har mahine {amt}?? ye kya hai"),
  t("consent", "hinglish", true, "beta ne trial liya tha mere phone se, {amt} kat gaye. pata hi nahi tha monthly hai"),
  t("consent", "hinglish", true, "free trial bola tha. {amt} ka message aaya tab samjha"),
  t("consent", "hinglish", true, "app ek baar khola bas, phir bhi {amt} kata. reminder bhi nahi aaya"),
  t("consent", "hinglish", true, "cancel kiya tha socha, phir bhi {amt} gaya. bahut bura laga"),
  t("consent", "hi", true, "1 रुपये का ट्रायल लिया था, {n} दिन बाद {amt} कट गए। किसी ने बताया नहीं"),
  t("consent", "hi", true, "ट्रायल के नाम पर हर महीने पैसा कटने लगा। मुझे पता ही नहीं था"),
  t("consent", "hi", true, "{amt} कट गए, मैंने तो सिर्फ़ देखने के लिए ऐप लिया था"),
  t("consent", "hi", true, "बिना पूछे पैसा काट लिया। ट्रायल के बाद कोई मैसेज नहीं आया"),
  t("consent", "en", true, "Good app but they took {amt} after free trial without any reminder. Please refund"),
  t("consent", "en", true, "Paid 1 rupee for the trial and got charged {amt} after {n} days. Nobody told me it was monthly"),
  t("consent", "en", true, "Never used the app after day one but money deducted. {amt} gone"),
  t("consent", "en", true, "Signed up for the trial, no idea autopay would start. Charged {amt}"),
  t("consent", "en", true, "They should tell you before charging. {amt} taken after trial"),
  t("consent", "hinglish", true, "trial khatam hote hi {amt}. koi notification nahi, kuch nahi"),
  t("consent", "en", true, "Autopay created in the background during the trial. Charged {amt}"),
  // name gap, low star
  t("name", "hinglish", true, "Bank msg me {legal} likha aaya, maine socha fraud hai. baad me pata chala ye {brand} hai"),
  t("name", "hinglish", true, "{legal} kaun hai? {amt} kat gaye. bank ko call kiya tab pata chala"),
  t("name", "hi", true, "बैंक के मैसेज में {legal} लिखा था, मैं डर गई कि खाता हैक हो गया"),
  t("name", "en", true, "SMS said {legal}. Thought my account was hacked. Turns out it is {brand}"),
  t("name", "en", true, "Got a debit from {legal} for {amt}, never heard of them. It was this app"),
  t("name", "hinglish", true, "statement me {legal} dikha, samajh nahi aaya kiska paisa hai"),
  // ownership gap, low star
  t("ownership", "hinglish", true, "uninstall kar diya tha phir bhi paisa kata. cancel kaha karna hai samajh nahi aaya"),
  t("ownership", "hinglish", true, "app bolta hai bank se baat karo, bank bolta hai app se. {amt} ka koi sunne wala nahi"),
  t("ownership", "hi", true, "ऐप हटा दिया था फिर भी पैसा कटा। बंद कहाँ करें समझ नहीं आया"),
  t("ownership", "en", true, "Uninstalled the app but still charged {amt}. Could not find where to cancel"),
  t("ownership", "en", true, "Support chatbot has no option for autopay. Ticket closed without action"),
  t("ownership", "hinglish", true, "customer care ka number hi nahi milta. autopay kaise band kare"),
  // failed_wanted, low star
  t("failed_wanted", "hinglish", true, "payment fail ho gaya aur match ke beech stream band. paisa daalne ke baad bhi chalu nahi hua"),
  t("failed_wanted", "en", true, "Autopay failed once and my subscription stopped right before the match"),
  t("failed_wanted", "hi", true, "पैसा नहीं कटा तो सर्विस बंद हो गई। मुझे तो चलानी थी"),
  t("failed_wanted", "en", true, "I want to keep paying but the renewal keeps failing and nobody tells me"),
  // other, low star
  t("other", "en", true, "App crashes on login. Very slow"),
  t("other", "hinglish", true, "video quality bahut kharab hai, buffering hoti rehti hai"),
  t("other", "hi", true, "ऐप बहुत धीमा चलता है"),
  t("other", "en", true, "Too many ads inside the app"),
  t("other", "hinglish", true, "content purana hai, naya kuch nahi aata"),
  t("other", "en", true, "Customer support replied after a week"),
  // mid and high star
  t("other", "en", false, "Nice app, works well most days"),
  t("other", "en", false, "Good content for the price"),
  t("other", "en", false, "Decent. Could be faster"),
  t("other", "en", false, "Very useful, I use it daily"),
  t("other", "en", false, "Renewal went through smoothly, no issues"),
  t("other", "hinglish", false, "accha app hai, roz use karta hoon"),
  t("other", "hinglish", false, "price theek hai, content bhi accha hai"),
  t("other", "hinglish", false, "badhiya hai, bas thoda slow hai"),
  t("other", "hinglish", false, "ghar mein sab use karte hain, mast hai"),
  t("other", "hinglish", false, "kaam ka app hai"),
  t("other", "hi", false, "अच्छा ऐप है, रोज़ इस्तेमाल करती हूँ"),
  t("other", "hi", false, "बढ़िया है, दाम भी ठीक है"),
  t("other", "hi", false, "बच्चों को पसंद आया"),
  t("other", "hi", false, "ठीक है, और बेहतर हो सकता है"),
  t("other", "en", false, "Easy to cancel and restart, liked that"),
  t("other", "en", false, "Good value. Payment reminders would help"),
  t("other", "hinglish", false, "har mahine time pe kat jata hai, koi dikkat nahi"),
  t("other", "en", false, "Works fine on my old phone too"),
  t("other", "hinglish", false, "support ne jaldi reply kiya"),
  t("other", "en", false, "Clean app, no complaints"),
];

export const AUTHOR_LETTERS = "ABDGHJKMNPRSTVY";
