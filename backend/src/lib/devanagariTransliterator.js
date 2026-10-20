/**
 * Converts Devanagari script (Hindi STT output for Urdu speakers) into clean,
 * natural Pakistani Roman Urdu / English so Hindi never appears in the dashboard.
 */

// Common whole-word Pakistani address/name dictionary for maximum accuracy
const DICTIONARY = {
  // Cities & Towns
  "लाहौर": "Lahore",
  "कराची": "Karachi",
  "इस्लामाबाद": "Islamabad",
  "रावलपिंडी": "Rawalpindi",
  "फैसलाबाद": "Faisalabad",
  "मुल्तान": "Multan",
  "पेशावर": "Peshawar",
  "गुजरांवाला": "Gujranwala",
  "सियालकोट": "Sialkot",
  "टाउन": "Town",
  "मॉडल टाउन": "Model Town",
  "इक़बाल टाउन": "Iqbal Town",
  "इकबाल टाउन": "Iqbal Town",
  "जोहर टाउन": "Johar Town",
  "जौहर टाउन": "Johar Town",
  "गुलबर्ग": "Gulberg",
  "डीएचए": "DHA",
  "डिफेंस": "Defence",
  "कैंट": "Cantt",
  "सदर": "Saddar",
  "मॉल": "Mall",
  "बाजार": "Bazaar",
  "मार्केट": "Market",

  // Address terms
  "गली": "Gali",
  "नंबर": "Number",
  "नम्बर": "Number",
  "रोड": "Road",
  "स्ट्रीट": "Street",
  "हाउस": "House",
  "मकान": "House",
  "ब्लॉक": "Block",
  "सेक्टर": "Sector",
  "फेज": "Phase",
  "फ्लोर": "Floor",
  "फ्लैट": "Flat",
  "अपार्टमेंट": "Apartment",
  "प्लाजा": "Plaza",
  "मेन": "Main",
  "पास": "Near",
  "के पास": "Near",
  "सामने": "Opposite",
  "नजदीक": "Near",

  // Common Names
  "अहमद": "Ahmad",
  "अहमैद": "Ahmad",
  "मोहम्मद": "Muhammad",
  "मुहम्मद": "Muhammad",
  "अली": "Ali",
  "उमर": "Umar",
  "उस्मान": "Usman",
  "खान": "Khan",
  "मलिक": "Malik",
  "चौधरी": "Chaudhry",
  "बट": "Butt",
  "शेख": "Sheikh",
  "हुसैन": "Hussain",
  "हसन": "Hassan",
  "बिलाल": "Bilal",
  "हम्जा": "Hamza",
  "हमज़ा": "Hamza",
  "जैन": "Zain",
  "तफैल": "Tufail",
  "अबु बकर": "Abu Bakr",
  "अबू बकर": "Abu Bakr",
  "शहजाद": "Shahzad",
  "शाहिद": "Shahid",
  "तारिक": "Tariq",
  "काशिफ": "Kashif",
  "फारूक": "Farooq",
  "रिजवान": "Rizwan",
  "सलमान": "Salman",
  "इरफान": "Irfan",
  "इमरान": "Imran",
  "बाबर": "Babar",
  "अकबर": "Akbar",
  "साकिब": "Saqib",
  "आसिफ": "Asif",
  "आमिर": "Aamir",
  "शाहजेब": "Shahzeb",
};

// Character-by-character phonetic map for any unmapped words
const VOWELS = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
  "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
};

const MATRAS = {
  "ा": "a", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ं": "n", "ँ": "n", "ः": "h", "्": "",
};

const CONSONANTS = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "w",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  // Nukta characters
  "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f",
};

export function hasDevanagari(text) {
  return /[\u0900-\u097F]/.test(String(text || ""));
}

export function transliterateDevanagariWord(word) {
  if (!word) return "";
  if (DICTIONARY[word]) return DICTIONARY[word];

  let out = "";
  let i = 0;
  const len = word.length;

  while (i < len) {
    const char = word[i];
    const nextChar = i + 1 < len ? word[i + 1] : "";
    const nukta = nextChar === "़";

    const key = nukta ? char + "़" : char;
    if (nukta) i++; // skip nukta

    if (CONSONANTS[key]) {
      const c = CONSONANTS[key];
      const afterChar = i + 1 < len ? word[i + 1] : "";
      if (MATRAS[afterChar] !== undefined) {
        out += c + MATRAS[afterChar];
        i++; // skip matra
      } else if (afterChar === "्") {
        // Halant — no inherent vowel
        out += c;
        i++; // skip halant
      } else if (i + 1 === len) {
        // Trailing consonant usually has no audible 'a' in Urdu/Hindi
        out += c;
      } else {
        // Default inherent 'a'
        out += c + "a";
      }
    } else if (VOWELS[key]) {
      out += VOWELS[key];
    } else if (MATRAS[key] !== undefined) {
      out += MATRAS[key];
    } else {
      out += key;
    }
    i++;
  }

  // Capitalize first letter
  if (out.length > 0) {
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

export function cleanUrduText(text) {
  if (!text || typeof text !== "string") return text;
  if (!hasDevanagari(text)) return text;

  let s = text;
  // 1. Replace multi-word dictionary phrases first
  for (const [hindi, roman] of Object.entries(DICTIONARY)) {
    if (hindi.includes(" ") && s.includes(hindi)) {
      s = s.split(hindi).join(roman);
    }
  }

  // 2. Transliterate remaining Devanagari tokens
  return s.replace(/[\u0900-\u097F]+/g, (match) => {
    return transliterateDevanagariWord(match);
  });
}
