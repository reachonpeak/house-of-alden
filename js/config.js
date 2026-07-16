/* ==========================================================================
   HOUSE OF ALDEN — THE ONLY FILE YOU NEED TO EDIT
   --------------------------------------------------------------------------
   Everything the shop knows lives here: your contact details and your products.
   Edit this file, save it, refresh the page. Nothing else needs to change.

   Rules:
   - Keep the quote marks " " around text.
   - Keep the commas at the end of each line.
   - `id` must be unique and must never change once a product is live
     (it is what the cart remembers).
   ========================================================================== */

const BUSINESS = {
  name: "House of Alden",
  established: "2026",                    // From your Udyam certificate (incorporated 01/07/2026)
  udyam: "UDYAM-PB-03-0079079",

  // The number that RECEIVES WhatsApp orders. Country code, no +, no spaces.
  // 917087511282 = +91 70875 11282 (Kawalpreet Kaur)
  whatsapp: "917087511282",

  people: [
    { name: "Kawalpreet Kaur", phone: "+91 70875 11282", tel: "917087511282" },
    { name: "Parvinder Kaur",  phone: "+91 6283 531 410", tel: "916283531410" },
  ],

  email: "mannkawalpreet3@gmail.com",
  address: {
    line1: "1560, Ward No. 5",
    line2: "Near Dispensary, Maur Mandi",
    city: "Bathinda, Punjab 151509",
    country: "India",
  },

  social: {
    instagram: "https://instagram.com/",   // ← paste your real Instagram link
    pinterest: "https://pinterest.com/",   // ← paste your real Pinterest link
  },

  currency: { code: "INR", symbol: "₹", locale: "en-IN" },

  shipping: {
    flatRate: 0,          // ₹0 = free shipping. Change to e.g. 120 to charge ₹120.
    freeAbove: 0,         // Free shipping above this order value. 0 = always free.
  },

  /* ---- Checkout -----------------------------------------------------------
     provider: "whatsapp"  → order opens in WhatsApp, pre-filled. LIVE NOW.
     provider: "razorpay"  → real card/UPI payment. See RAZORPAY.md to switch on.
     Change the one word below when you are ready. Nothing else moves.        */
  checkout: {
    provider: "whatsapp",
    razorpay: {
      keyId: "",                          // ← your rzp_live_xxxx key (public, safe here)
      createOrderUrl: "/api/create-order" // ← your server endpoint (see RAZORPAY.md)
    },
  },
};

/* ==========================================================================
   PRODUCTS
   --------------------------------------------------------------------------
   category  : "watches" or "earrings"
   price     : plain number, no ₹ and no commas.  8900  not  "₹8,900"
   image     : a file inside the images/ folder
   stock     : true = buyable, false = shows "Sold Out"
   badge     : "" for none, or short text like "New" / "Last One"
   specs     : the little table on the product page. Add or remove freely.
   ========================================================================== */

const PRODUCTS = [
  {
    id: "alden-heritage",
    name: "The Alden Heritage",
    category: "watches",
    price: 8900,
    image: "images/watch-alden-heritage.webp",
    alt: "Gold-cased wristwatch with a cream enamel dial, black Roman numerals and a tan leather strap.",
    stock: true,
    badge: "",
    blurb: "A cream enamel dial and blued hands, on hand-finished tan leather.",
    description:
      "The watch the house is named for. A warm enamel dial, Roman numerals set by hand, and slender blued steel hands that catch the light only when they mean to. The tan leather strap is left undyed at the edges so it darkens with the years — the piece is meant to look more like yours the longer you wear it.",
    specs: [
      ["Case", "38 mm, gold-tone"],
      ["Dial", "Cream enamel, Roman numerals"],
      ["Movement", "Quartz"],
      ["Strap", "Tan calf leather, 20 mm"],
      ["Water resistance", "3 ATM"],
    ],
  },
  {
    id: "maur-field",
    name: "The Maur Field",
    category: "watches",
    price: 6400,
    image: "images/watch-maur-field.webp",
    alt: "Field wristwatch with a matte off-white dial, brushed steel case and olive canvas strap.",
    stock: true,
    badge: "",
    blurb: "A plain-spoken field watch. Brushed steel and olive canvas.",
    description:
      "Named for the town it was drawn in. No ceremony: a matte dial you can read at a glance, a brushed case that hides its scratches, and a canvas strap you can wash. The most honest watch we make, and the one we wear most.",
    specs: [
      ["Case", "40 mm, brushed steel"],
      ["Dial", "Matte off-white"],
      ["Movement", "Quartz"],
      ["Strap", "Olive canvas, 20 mm"],
      ["Water resistance", "5 ATM"],
    ],
  },
  {
    id: "regent-moonphase",
    name: "The Regent Moonphase",
    category: "watches",
    price: 14500,
    image: "images/watch-regent-moonphase.webp",
    alt: "Gold wristwatch with a midnight blue dial, crescent moon and stars sub-dial, and dark brown alligator-grain strap.",
    stock: true,
    badge: "New",
    blurb: "A midnight dial with the moon kept in one small window.",
    description:
      "Our most ornamental piece, and the only one that keeps track of something other than the hour. A midnight blue dial, a gilt crescent turning slowly through its window, and an alligator-grain strap in dark brown. Worn best in the evening, which is rather the point.",
    specs: [
      ["Case", "39 mm, gold-tone"],
      ["Dial", "Midnight blue, moonphase"],
      ["Movement", "Quartz, moonphase complication"],
      ["Strap", "Alligator-grain leather, 20 mm"],
      ["Water resistance", "3 ATM"],
    ],
  },
  {
    id: "ward-slim",
    name: "The Ward Slim",
    category: "watches",
    price: 7200,
    image: "images/watch-ward-slim.webp",
    alt: "Ultra-slim gold wristwatch with a plain cream dial, two fine hands and a slim cognac leather strap.",
    stock: true,
    badge: "",
    blurb: "Two hands, no markers, nothing else. Slips under a cuff.",
    description:
      "Everything removed that could be removed. A bare cream dial, two fine gold hands, and a case slim enough to disappear under a shirt cuff. It tells you the hour and declines to tell you anything more.",
    specs: [
      ["Case", "36 mm, gold-tone, 6 mm thin"],
      ["Dial", "Cream, unmarked"],
      ["Movement", "Quartz"],
      ["Strap", "Cognac calf leather, 18 mm"],
      ["Water resistance", "3 ATM"],
    ],
  },
  {
    id: "pearl-drop",
    name: "The Alden Pearl Drop",
    category: "earrings",
    price: 3400,
    image: "images/earring-pearl-drop.webp",
    alt: "Pair of gold drop earrings, each with a round freshwater pearl on a fine hook.",
    stock: true,
    badge: "",
    blurb: "A single freshwater pearl on a fine gold hook.",
    description:
      "The pair we recommend first. One freshwater pearl, one fine gold hook, and no argument. Light enough to forget you have them on, and quiet enough to wear to anything at all.",
    specs: [
      ["Metal", "Gold-plated brass"],
      ["Stone", "Freshwater pearl, 7 mm"],
      ["Drop length", "24 mm"],
      ["Fitting", "Hook"],
      ["Weight", "1.8 g per earring"],
    ],
  },
  {
    id: "filigree-hoop",
    name: "The Filigree Hoop",
    category: "earrings",
    price: 2900,
    image: "images/earring-filigree-hoop.webp",
    alt: "Pair of ornate antique gold filigree hoop earrings with fine scrollwork detail.",
    stock: true,
    badge: "",
    blurb: "Antique scrollwork, drawn in fine gold wire.",
    description:
      "Scrollwork copied from a pattern book older than any of us, worked in fine gold wire. The kind of hoop that reads as plain from across a room and rewards anyone who comes closer.",
    specs: [
      ["Metal", "Gold-plated brass"],
      ["Diameter", "28 mm"],
      ["Fitting", "Hinged hoop"],
      ["Finish", "Antiqued"],
      ["Weight", "2.4 g per earring"],
    ],
  },
  {
    id: "rosette-stud",
    name: "The Heirloom Rosette",
    category: "earrings",
    price: 2200,
    image: "images/earring-rosette-stud.webp",
    alt: "Pair of small gold stud earrings, each an engraved rosette with a deep red garnet at the centre.",
    stock: true,
    badge: "",
    blurb: "An engraved rosette holding one small garnet.",
    description:
      "A small engraved rosette with a garnet at its heart — the deep red that old jewellery always seems to choose. Our most everyday piece, and the one most often bought in twos, for a mother and a daughter.",
    specs: [
      ["Metal", "Gold-plated brass"],
      ["Stone", "Garnet, 3 mm"],
      ["Diameter", "9 mm"],
      ["Fitting", "Butterfly stud"],
      ["Weight", "1.1 g per earring"],
    ],
  },
  {
    id: "vine-chandelier",
    name: "The Vine Chandelier",
    category: "earrings",
    price: 4600,
    image: "images/earring-vine-chandelier.webp",
    alt: "Pair of long ornate gold chandelier earrings with a cascading vine and leaf motif and small dangling teardrops.",
    stock: false,
    badge: "",
    blurb: "A cascade of leaves and small swinging teardrops.",
    description:
      "Our loudest piece, which is to say it is still fairly quiet. Leaves cascade down a fine gold vine and end in teardrops that swing when you turn your head. Made in small numbers, because each one takes an afternoon.",
    specs: [
      ["Metal", "Gold-plated brass"],
      ["Drop length", "62 mm"],
      ["Fitting", "Hook"],
      ["Finish", "Antiqued"],
      ["Weight", "4.2 g per earring"],
    ],
  },
];

/* --- Journal entries (shown on journal.html) ------------------------------ */
const JOURNAL = [
  {
    title: "Why We Chose the Moon",
    date: "12 July 2026",
    excerpt:
      "A moonphase does nothing useful. It will not get you to a meeting on time. We put one on the Regent anyway, and this is our defence.",
  },
  {
    title: "On Leather That Darkens",
    date: "05 July 2026",
    excerpt:
      "We leave the edges of our straps undyed. They look unfinished on the first day. That is deliberate, and here is what happens by the hundredth.",
  },
  {
    title: "A House in Maur Mandi",
    date: "01 July 2026",
    excerpt:
      "House of Alden began in a room above a dispensary in Maur Mandi, Bathinda, with two people and a drawer of old jewellery. It still does.",
  },
];
