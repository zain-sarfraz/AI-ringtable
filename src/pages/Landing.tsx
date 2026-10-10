import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { BILLING_PLANS, BillingInterval, formatPlanPrice, planAmount } from "@/lib/billingPlans";
import { BRAND_ASSETS, PRODUCT_EMAIL, PRODUCT_NAME, productTitle } from "@/lib/brand";
import "./landing.css";

const FAQS = [
  {
    q: "We already have a POS. Do we need to replace it?",
    a: "No. Ringtable automates the parts around your POS — phone calls, reservations, QR and online ordering. Your POS stays where it is.",
  },
  {
    q: "Will customers know they're talking to AI?",
    a: "Yes, if they ask — the receptionist is honest that it's an AI assistant and transfers to your team whenever a guest prefers a person or asks something it can't answer.",
  },
  {
    q: "What if an item is sold out?",
    a: "Mark it unavailable in one tap. The AI, QR menu and website update instantly, and the AI suggests an available alternative.",
  },
  {
    q: 'Can it handle modifiers like "no onion, extra cheese"?',
    a: "Yes. Your menu is loaded as structured data — sizes, crusts, add-ons and removals — and the AI reads the full order back before sending it to the kitchen.",
  },
  {
    q: "Do I need to change my phone number?",
    a: "No. You keep your number and forward calls to the AI — all calls, or only when your staff are busy or after hours.",
  },
  {
    q: "How long is the contract?",
    a: "Monthly or yearly through Stripe. Cancel anytime. Yearly Starter and Growth include 2 months free. Pilot restaurants get Growth at $400/mo, locked for 1 year.",
  },
];

function BrandMark({ variant = "mark" }: { variant?: "mark" | "wordmark" }) {
  if (variant === "wordmark") {
    return (
      <img
        className="brand-wordmark"
        src={BRAND_ASSETS.logoHorizontalWhite}
        alt={PRODUCT_NAME}
        width={168}
        height={42}
      />
    );
  }
  return (
    <span className="lg" aria-hidden="true">
      <img src={BRAND_ASSETS.appIcon} alt="" width={44} height={44} />
    </span>
  );
}

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#engine", label: "Order Engine" },
  { href: "#ai", label: "AI Receptionist" },
  { href: "#results", label: "Results" },
  { href: "#roi", label: "ROI" },
  { href: "#pricing", label: "Pricing" },
];

function money(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function AuditForm() {
  const [done, setDone] = useState(false);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setDone(true);
  };
  return (
    <form className="leadform" onSubmit={onSubmit}>
      <div className="fw-bold" style={{ fontSize: 17 }}>
        Get a free Missed-Call Audit of your restaurant
      </div>
      <p className="text-mut mb-3" style={{ fontSize: 13 }}>
        We call your restaurant like a real customer at peak hours and send you a report — free, in 48 hours.
      </p>
      <div className="row g-2">
        <div className="col-sm-6">
          <input className="form-control" name="restaurant" placeholder="Restaurant name" required disabled={done} />
        </div>
        <div className="col-sm-6">
          <input className="form-control" name="phone" type="tel" placeholder="Your phone" required disabled={done} />
        </div>
        <div className="col-sm-6">
          <input className="form-control" name="email" type="email" placeholder="Work email" required disabled={done} />
        </div>
        <div className="col-sm-6">
          <select className="form-select" name="locations" disabled={done} defaultValue="1">
            <option value="1">Locations: 1</option>
            <option value="2-3">2–3</option>
            <option value="4-5">4–5</option>
            <option value="6+">6+</option>
          </select>
        </div>
        <div className="col-12">
          <button className="btn btn-or w-100" type="submit" disabled={done}>
            {done ? "Thanks! We'll be in touch within 24 hours ✓" : "Send My Free Audit →"}
          </button>
        </div>
      </div>
      <div className="text-center text-mut mt-2" style={{ fontSize: 12 }}>
        No credit card · No POS change · Takes 30 seconds
      </div>
    </form>
  );
}

function DemoForm() {
  const [done, setDone] = useState(false);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setDone(true);
  };
  return (
    <form className="demo" onSubmit={onSubmit}>
      <b style={{ fontSize: 20 }}>Book your 10-minute demo</b>
      <p className="text-mut mb-3" style={{ fontSize: 13 }}>
        Includes your free Missed-Call Audit
      </p>
      <div className="row g-2 mb-2">
        <div className="col-sm-6">
          <input className="form-control" name="restaurant" placeholder="Restaurant name" required disabled={done} />
        </div>
        <div className="col-sm-6">
          <input className="form-control" name="name" placeholder="Your name" required disabled={done} />
        </div>
        <div className="col-sm-6">
          <input className="form-control" name="phone" type="tel" placeholder="Phone" required disabled={done} />
        </div>
        <div className="col-sm-6">
          <input className="form-control" name="email" type="email" placeholder="Work email" required disabled={done} />
        </div>
        <div className="col-sm-6">
          <input className="form-control" name="city" placeholder="City / ZIP" disabled={done} />
        </div>
        <div className="col-sm-6">
          <select className="form-select" name="pos" defaultValue="" disabled={done}>
            <option value="">Current POS</option>
            <option>Square</option>
            <option>Toast</option>
            <option>Clover</option>
            <option>Lightspeed</option>
            <option>Other</option>
            <option>None</option>
          </select>
        </div>
      </div>
      <div className="lbl">Number of locations</div>
      <input className="chip-check" type="radio" name="loc" id="l1" value="1" defaultChecked disabled={done} />
      <label className="chip" htmlFor="l1">1</label>
      <input className="chip-check" type="radio" name="loc" id="l2" value="2-3" disabled={done} />
      <label className="chip" htmlFor="l2">2–3</label>
      <input className="chip-check" type="radio" name="loc" id="l3" value="4-5" disabled={done} />
      <label className="chip" htmlFor="l3">4–5</label>
      <input className="chip-check" type="radio" name="loc" id="l4" value="6+" disabled={done} />
      <label className="chip" htmlFor="l4">6+</label>
      <div className="lbl">What do you want to fix first?</div>
      <input className="chip-check" type="checkbox" name="fix" id="x1" value="missed-calls" defaultChecked disabled={done} />
      <label className="chip" htmlFor="x1">Missed calls</label>
      <input className="chip-check" type="checkbox" name="fix" id="x2" value="phone-orders" disabled={done} />
      <label className="chip" htmlFor="x2">Phone orders</label>
      <input className="chip-check" type="checkbox" name="fix" id="x3" value="reservations" defaultChecked disabled={done} />
      <label className="chip" htmlFor="x3">Reservations</label>
      <input className="chip-check" type="checkbox" name="fix" id="x4" value="qr" disabled={done} />
      <label className="chip" htmlFor="x4">QR ordering</label>
      <input className="chip-check" type="checkbox" name="fix" id="x5" value="reporting" disabled={done} />
      <label className="chip" htmlFor="x5">Reporting</label>
      <div className="lbl">Best time for a call</div>
      <input className="chip-check" type="radio" name="time" id="t1" value="morning" disabled={done} />
      <label className="chip" htmlFor="t1">Morning</label>
      <input className="chip-check" type="radio" name="time" id="t2" value="2-5pm" defaultChecked disabled={done} />
      <label className="chip" htmlFor="t2">2–5 PM</label>
      <input className="chip-check" type="radio" name="time" id="t3" value="after-close" disabled={done} />
      <label className="chip" htmlFor="t3">After close</label>
      <button className="btn btn-or w-100 mt-2" type="submit" disabled={done}>
        {done ? "Thanks! We'll be in touch within 24 hours ✓" : "Book My Demo →"}
      </button>
      <div className="text-center text-mut mt-2" style={{ fontSize: 11.5 }}>
        We'll only contact you about your demo. No spam.
      </div>
    </form>
  );
}

function RoiCalculator() {
  const [calls, setCalls] = useState(60);
  const [missed, setMissed] = useState(20);
  const [aov, setAov] = useState(38);
  const [orderPct, setOrderPct] = useState(40);
  const [hours, setHours] = useState(4);
  const missedOrders = Math.round(calls * (missed / 100) * 30 * (orderPct / 100));
  const risk = missedOrders * aov;
  const multiple = Math.max(0, Math.round(risk / 599));

  return (
    <div className="roi row g-0">
      <div className="col-lg-6 roil">
        <label htmlFor="calls">
          Calls per day <b>{calls}</b>
        </label>
        <input id="calls" className="form-range" type="range" min={10} max={200} step={5} value={calls} onChange={(e) => setCalls(Number(e.target.value))} />
        <label htmlFor="missed">
          % of calls missed at peak <b>{missed}%</b>
        </label>
        <input id="missed" className="form-range" type="range" min={5} max={50} value={missed} onChange={(e) => setMissed(Number(e.target.value))} />
        <label htmlFor="aov">
          Average order value <b>${aov}</b>
        </label>
        <input id="aov" className="form-range" type="range" min={10} max={120} value={aov} onChange={(e) => setAov(Number(e.target.value))} />
        <label htmlFor="orderPct">
          % of calls that are orders <b>{orderPct}%</b>
        </label>
        <input id="orderPct" className="form-range" type="range" min={10} max={80} value={orderPct} onChange={(e) => setOrderPct(Number(e.target.value))} />
        <label htmlFor="hours">
          Hours staff spend on the phone / day <b>{hours} hrs</b>
        </label>
        <input id="hours" className="form-range mb-0" type="range" min={1} max={12} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
      </div>
      <div className="col-lg-6">
        <div className="roir">
          <div style={{ color: "#9AA6B8", fontSize: 15 }}>Estimated revenue at risk from missed calls</div>
          <div className="big">
            <span>{money(risk)}</span>
            <span style={{ fontSize: 22, color: "#9AA6B8" }}>/mo</span>
          </div>
          <div className="rr">
            <span>Missed order calls / month</span>
            <b>{missedOrders.toLocaleString("en-US")}</b>
          </div>
          <div className="rr">
            <span>Staff phone hours freed / month</span>
            <b>{hours * 30} hrs</b>
          </div>
          <div className="rr">
            <span>{PRODUCT_NAME} Growth plan</span>
            <b>$599/mo</b>
          </div>
          <div className="rr border-0">
            <span>Potential monthly upside</span>
            <b style={{ color: "var(--or2)" }}>≈ {multiple}× the plan cost</b>
          </div>
          <a href="#demo" className="btn btn-or w-100 mt-3">
            Email Me This Report →
          </a>
          <div className="text-center mt-2" style={{ fontSize: 12, color: "#7F8BA0" }}>
            Estimate based on your inputs — not a guarantee.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");

  useEffect(() => {
    const previous = document.title;
    document.title = productTitle("Never Miss a Restaurant Order Again");
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="lp" id="top">
      <div className="ann">
        🗽 Now onboarding 10 founding pilot restaurants in New York City — Growth at $400/mo for 1 year{" "}
        <a href="#audit">4 spots left →</a>
      </div>

      <nav className="navwrap">
        <div className="container navrow">
          <a className="brand" href="#top" aria-label={PRODUCT_NAME}>
            <BrandMark variant="wordmark" />
          </a>
          <button className="nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
            ☰
          </button>
          <div className={`nav-menu${navOpen ? " open" : ""}`}>
            <ul className="navlinks">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a href={item.href} onClick={() => setNavOpen(false)}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="nav-actions">
              <a href="tel:+12025550148" className="nav-phone">
                📞 (202) 555-0148
              </a>
              {user ? (
                <Link to="/dashboard" className="btn-login">
                  Dashboard
                </Link>
              ) : (
                <Link to="/login" className="btn-login">
                  Login
                </Link>
              )}
              <a href="#audit" className="btn btn-or py-2 px-3" onClick={() => setNavOpen(false)}>
                Get Free Audit
              </a>
            </div>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="container">
          <div className="row g-5 align-items-center">
            <div className="col-lg-6">
              <span className="eyebrow dark">● The AI restaurant operating system</span>
              <h1>
                Never miss a restaurant <span>order</span> again.
              </h1>
              <p className="lead">
                Our AI answers every call, takes pickup orders, books tables, and sends phone, QR, website and staff orders straight to your kitchen — in one order inbox.
              </p>
              <AuditForm />
              <div className="proof">
                <div className="dots">
                  <i />
                  <i />
                  <i />
                </div>
                <span>
                  <b className="text-white">Built for independent restaurants</b> · 1–5 locations · 20–150 seats
                </span>
              </div>
            </div>
            <div className="col-lg-6">
              <div className="position-relative mt-lg-4">
                <div className="float-card" style={{ right: -30, top: -62 }}>
                  <div className="ic" style={{ background: "var(--orl)", width: 34, height: 34, fontSize: 16 }}>
                    💰
                  </div>
                  <div>
                    <b>+$1,420</b> captured this week
                    <br />
                    <span className="text-mut">from calls staff couldn't take</span>
                  </div>
                </div>
                <div className="inbox">
                  <div className="ibh">
                    <div>
                      <b style={{ fontSize: 16 }}>One Order Inbox</b>
                      <div className="text-mut" style={{ fontSize: 12 }}>
                        All channels · Live
                      </div>
                    </div>
                    <span className="stt rdy">● 4 new orders</span>
                  </div>
                  <div className="flt">
                    <span className="on">All</span>
                    <span>📞 Phone</span>
                    <span>📱 QR</span>
                    <span>🌐 Website</span>
                    <span>👨‍🍳 Staff</span>
                    <span>Pickup</span>
                    <span>Dine-in</span>
                    <span>Delivery</span>
                  </div>
                  <div className="oc">
                    <span className="src s1">PHONE AI</span>
                    <div>
                      <b>#1042</b> · 2× Chicken Burger, 1× Coke
                      <br />
                      <span className="text-mut">Pickup · ready in 10 min · Mike R.</span>
                    </div>
                    <span className="stt new">NEW</span>
                  </div>
                  <div className="oc">
                    <span className="src s2">TABLE QR</span>
                    <div>
                      <b>#1043</b> · 2× Steak, 1× Caesar Salad
                      <br />
                      <span className="text-mut">Dine-in · Table 18</span>
                    </div>
                    <span className="stt cook">COOKING</span>
                  </div>
                  <div className="oc">
                    <span className="src s3">WEBSITE</span>
                    <div>
                      <b>#1044</b> · 3× Margherita Pizza
                      <br />
                      <span className="text-mut">Pickup · 6:45 PM</span>
                    </div>
                    <span className="stt new">NEW</span>
                  </div>
                  <div className="oc">
                    <span className="src s1">PHONE AI</span>
                    <div>
                      <b>#1045</b> · 1× Lobster Roll, 2× Fries
                      <br />
                      <span className="text-mut">Delivery · Brooklyn</span>
                    </div>
                    <span className="stt rdy">READY</span>
                  </div>
                  <div className="oc border-0">
                    <span className="src s5">WAITER</span>
                    <div>
                      <b>#1046</b> · 4× Dinner Special
                      <br />
                      <span className="text-mut">Dine-in · Table 7</span>
                    </div>
                    <span className="stt cook">COOKING</span>
                  </div>
                </div>
                <div className="float-card" style={{ left: -50, bottom: -78 }}>
                  <div className="ic" style={{ background: "#E8F7EE", width: 34, height: 34, fontSize: 16 }}>
                    📞
                  </div>
                  <div>
                    <b>AI answered call #47 tonight</b>
                    <br />
                    <span className="text-mut">Reservation · 4 guests · 8:00 PM</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stats">
        <div className="container">
          <div className="row g-4 text-center">
            <div className="col-6 col-lg-3">
              <b>
                24<em>/</em>7
              </b>
              <p>Calls answered, even at 8 PM Friday rush</p>
            </div>
            <div className="col-6 col-lg-3">
              <b>
                4 <em>channels</em>
              </b>
              <p>Phone · QR · Website · Staff</p>
            </div>
            <div className="col-6 col-lg-3">
              <b>
                1 <em>inbox</em>
              </b>
              <p>Every order, one kitchen workflow</p>
            </div>
            <div className="col-6 col-lg-3">
              <b>
                10 <em>min</em>
              </b>
              <p>Demo built on your actual menu</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="problem">
        <div className="container">
          <div className="sh">
            <span className="eyebrow red">The Problem</span>
            <h2>A full dining room can still lose customers — because nobody answers the phone.</h2>
            <p>Independent restaurants are fighting labor costs, rising prices and too many disconnected tools. The leaks are hard to see.</p>
          </div>
          <div className="row g-4">
            {[
              ["📵", "Unanswered calls at rush", "When the host is seating guests, the phone rings out. That caller orders from the place down the block.", "Every missed call is a missed ticket"],
              ["🧩", "Orders in 3 different places", "Phone notes, a QR app and a website plugin — each with its own screen, and none talk to the kitchen.", "Lost tickets, double entry, delays"],
              ["✍️", "Wrong orders, wrong modifiers", '"No onion, extra cheese, thin crust" gets lost between the phone and the kitchen. Remakes and refunds follow.', "Remakes eat your margin"],
              ["🦞", "Selling what you're out of", "Staff and apps keep taking orders for items the kitchen ran out of an hour ago. Then someone has to call back.", "Awkward callbacks & bad reviews"],
              ["📒", "Reservations in a notebook", "Double bookings, no-shows and no idea who your regulars are or how often they come back.", "No customer history"],
              ["💸", "No idea what's working", "You can't see how many calls you missed, which channel brings revenue, or what your staff time is worth.", "Decisions made on gut feel"],
            ].map(([icon, title, body, cost]) => (
              <div className="col-md-6 col-lg-4" key={title}>
                <div className="cardx pc">
                  <div className="ic">{icon}</div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <div className="cost">{cost}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec sol" id="engine">
        <div className="container">
          <div className="sh">
            <span className="eyebrow dark">Every Order. One Kitchen.</span>
            <h2>Every customer channel flows into one Order Engine.</h2>
            <p>No more separate systems. Phone, QR, website and waiter orders all become the same order — with the same status, in the same kitchen workflow.</p>
          </div>
          <div className="row g-3">
            {[
              ["📞", "Phone", "AI Receptionist takes the order", "PHONE_AI"],
              ["📱", "QR Table", "Guests order from their seat", "QR_TABLE"],
              ["🌐", "Website", "Online pickup & delivery", "WEBSITE"],
              ["👨‍🍳", "Staff", "Waiter enters at the table", "STAFF"],
            ].map(([icon, title, sub, code]) => (
              <div className="col-6 col-lg-3" key={code}>
                <div className="ch">
                  <div className="e">{icon}</div>
                  <b>{title}</b>
                  <small>{sub}</small>
                  <br />
                  <code>{code}</code>
                </div>
              </div>
            ))}
          </div>
          <div className="flow">
            <svg viewBox="0 0 1200 70" preserveAspectRatio="none" aria-hidden="true">
              <g stroke="#F26A1B" strokeWidth="2" fill="none" strokeDasharray="6 6">
                <path d="M150 0 C150 40 600 30 600 70" />
                <path d="M450 0 C450 40 600 30 600 70" />
                <path d="M750 0 C750 40 600 30 600 70" />
                <path d="M1050 0 C1050 40 600 30 600 70" />
              </g>
            </svg>
          </div>
          <div className="core">
            <b>⚙️ ONE ORDER ENGINE</b>
            <p>Every order gets the same structure, status and audit trail</p>
            <div className="fl">
              {["order_id", "branch_id", "source", "customer", "order_type", "items + modifiers", "table", "payment_status", "order_status"].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
          <div className="flow">
            <svg viewBox="0 0 1200 70" preserveAspectRatio="none" aria-hidden="true">
              <g stroke="#F26A1B" strokeWidth="2" fill="none" strokeDasharray="6 6">
                <path d="M600 0 C600 40 150 30 150 70" />
                <path d="M600 0 C600 40 450 30 450 70" />
                <path d="M600 0 C600 40 750 30 750 70" />
                <path d="M600 0 C600 40 1050 30 1050 70" />
              </g>
            </svg>
          </div>
          <div className="row g-3">
            {[
              ["🔥", "var(--orl)", "Kitchen", "KDS screen or printer"],
              ["🛎️", "#E8F1FF", "Front Desk", "Staff dashboard & tables"],
              ["👤", "#ECFDF3", "Customers", "History & reservations"],
              ["📊", "#F3E8FF", "Owner Dashboard", "Analytics & revenue"],
            ].map(([icon, bg, title, sub]) => (
              <div className="col-6 col-lg-3" key={title}>
                <div className="out">
                  <div className="ic" style={{ background: bg }}>
                    {icon}
                  </div>
                  <div>
                    <b>{title}</b>
                    <small>{sub}</small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec" id="ai">
        <div className="container">
          <div className="row g-5 align-items-center dd mb-5 pb-4">
            <div className="col-lg-6">
              <span className="eyebrow">The Ringtable Brain</span>
              <h2>An AI that knows your menu — down to the last modifier.</h2>
              <p className="l">
                We don't just upload a PDF menu. Your AI works from structured data: items, sizes, modifiers, combos, hours, policies — and what's sold out right now.
              </p>
              <ul className="ticks">
                <li>Sizes, crusts, add-ons & "no onion" handled correctly</li>
                <li>86'd items switch off in one tap — AI offers an alternative</li>
                <li>Reads back the full order & total before submitting</li>
                <li>Never invents prices, items or reservation slots</li>
                <li>Hands off to your team when it isn't sure</li>
              </ul>
            </div>
            <div className="col-lg-6">
              <div className="vis">
                <div className="row g-3">
                  <div className="col-sm-6">
                    <div className="panel">
                      <b style={{ fontSize: 14 }}>Menu · Live availability</b>
                      <div className="mrow">
                        <div>
                          <b>Large Chicken Pizza</b> · $19.99
                          <br />
                          <span className="tg">Thin</span>
                          <span className="tg">Stuffed</span>
                          <span className="tg">+ Extra cheese</span>
                          <span className="tg">No onion</span>
                        </div>
                        <span className="sw" />
                      </div>
                      <div className="mrow">
                        <div>
                          <b>Lobster Pasta</b> · $32.00
                          <br />
                          <span style={{ color: "var(--red)", fontSize: 11, fontWeight: 600 }}>Sold out today</span>
                        </div>
                        <span className="sw off" />
                      </div>
                      <div className="mrow">
                        <div>
                          <b>Shrimp Pasta</b> · $26.00
                          <br />
                          <span className="tg">Spicy</span>
                          <span className="tg">Gluten-free</span>
                        </div>
                        <span className="sw" />
                      </div>
                      <div className="mrow border-0">
                        <div>
                          <b>Caesar Salad</b> · $12.50
                          <br />
                          <span className="tg">+ Chicken $5</span>
                        </div>
                        <span className="sw" />
                      </div>
                    </div>
                  </div>
                  <div className="col-sm-6">
                    <div className="panel">
                      <div style={{ fontSize: 12, color: "var(--grn)", fontWeight: 600 }}>● AI Receptionist · live call</div>
                      <div className="bub cu">I'd like the lobster pasta.</div>
                      <div className="bub ai">Sorry, the lobster pasta is sold out today. Our shrimp pasta is very popular — would you like that instead?</div>
                      <div className="bub cu">Sure, plus a large chicken pizza, extra cheese, no onions.</div>
                      <div className="bub ai">To confirm: 1 shrimp pasta, 1 large chicken pizza with extra cheese and no onions. Pickup total $45.99 before tax. Correct?</div>
                      <div className="text-center fw-bold mt-2" style={{ fontSize: 11, color: "var(--grn)" }}>
                        ✓ CONFIRMED → SENT TO KITCHEN #1047
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-4">
            <div className="col-lg-4">
              <div className="cardx mini-card">
                <span className="eyebrow" style={{ fontSize: 11 }}>
                  Reservations
                </span>
                <h3>Real availability, never double-booked</h3>
                <p>AI only confirms slots your system actually has, and offers the nearest times if a slot is full.</p>
                <div className="mini">
                  <b>Fri, Oct 9 · Party of 4</b>
                  <br />
                  <span className="slot x">7:00</span>
                  <span className="slot x">7:30</span>
                  <span className="slot on">7:45</span>
                  <span className="slot">8:00</span>
                  <span className="slot">8:30</span>
                  <div className="text-mut mt-2">Name, phone & requests captured · SMS reminder sent</div>
                </div>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="cardx mini-card">
                <span className="eyebrow" style={{ fontSize: 11 }}>
                  Kitchen Routing
                </span>
                <h3>Straight to the right station</h3>
                <p>Tickets go to KDS screens or printers by station and location, with live status back to the front desk.</p>
                <div className="mini">
                  <div className="kt">
                    <b>#1047 · PHONE AI · Pickup 7:10</b>
                    <br />
                    1× Shrimp Pasta · 1× L Chicken Pizza
                    <br />
                    <span style={{ color: "var(--red)" }}>Extra cheese · NO ONION</span>
                  </div>
                  <div className="kt" style={{ borderLeftColor: "#1D4ED8" }}>
                    <b>#1043 · TABLE 18</b>
                    <br />
                    2× Steak (MR, M) · 1× Caesar
                  </div>
                </div>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="cardx mini-card">
                <span className="eyebrow" style={{ fontSize: 11 }}>
                  Staff Roles & Audit Log
                </span>
                <h3>The right access for every role</h3>
                <p>Owners, managers, hosts, waiters and kitchen each see only what they need. Every change is logged.</p>
                <div className="mini">
                  <div className="role">
                    <b>Permission</b>
                    <span>Owner · Mgr · Host · Kitchen</span>
                  </div>
                  <div className="role">
                    <span>Refunds</span>
                    <span>
                      <span className="ck">✓</span> &nbsp;<span className="ck">✓</span> &nbsp;<span className="no">—</span> &nbsp;<span className="no">—</span>
                    </span>
                  </div>
                  <div className="role">
                    <span>Edit menu / 86 items</span>
                    <span>
                      <span className="ck">✓</span> &nbsp;<span className="ck">✓</span> &nbsp;<span className="no">—</span> &nbsp;<span className="ck">✓</span>
                    </span>
                  </div>
                  <div className="role border-0">
                    <span>Reservations</span>
                    <span>
                      <span className="ck">✓</span> &nbsp;<span className="ck">✓</span> &nbsp;<span className="ck">✓</span> &nbsp;<span className="no">—</span>
                    </span>
                  </div>
                  <div className="text-mut mt-2">🕑 6:42 PM · Sam (Manager) marked Lobster Pasta sold out</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sec cs" id="results">
        <div className="container">
          <div className="sh">
            <span className="eyebrow">Sell the money, not the tech</span>
            <h2>See exactly what the AI earns you — every month.</h2>
            <p>Your owner dashboard shows calls handled, orders captured, revenue by channel and the missed calls the AI recovered.</p>
          </div>
          <div className="perf">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
              <div>
                <b style={{ fontSize: 20 }}>Restaurant AI Performance</b>
                <div className="text-mut" style={{ fontSize: 14 }}>
                  This month · All locations
                </div>
              </div>
              <div className="segs">
                <span>7D</span>
                <span className="on">30D</span>
                <span>90D</span>
              </div>
            </div>
            <div className="row g-3">
              {[
                ["📞 Calls received", "1,284", "▲ 12% vs last month"],
                ["🤖 Calls handled by AI", "1,173", "91% of all calls"],
                ["🍔 Orders captured by AI", "287", "▲ 18%"],
                ["🍽 Reservations booked", "164", "▲ 9%"],
                ["📱 QR table orders", "421", "▲ 22%"],
                ["💰 Total order value", "$18,742", "▲ 15%"],
                ["⏱ Staff interactions automated", "932", "≈ 78 staff hours"],
                ["⚠️ Escalated to staff", "41", "3.5% of calls", true],
              ].map((row) => (
                <div className="col-6 col-lg-3" key={String(row[0])}>
                  <div className="kpi">
                    <small>{row[0]}</small>
                    <b>{row[1]}</b>
                    <em className={row[3] ? "text-mut" : undefined}>{row[2]}</em>
                  </div>
                </div>
              ))}
            </div>
            <div className="row g-3 mt-1">
              <div className="col-lg-7">
                <div className="box">
                  <b>Revenue attribution</b>
                  <div className="d-flex flex-wrap gap-4 align-items-center mt-3">
                    <div className="donut" />
                    <div className="leg flex-grow-1">
                      <div>
                        <span>
                          <i style={{ background: "var(--or)" }} />
                          AI phone orders
                        </span>
                        <b>$6,840</b>
                      </div>
                      <div>
                        <span>
                          <i style={{ background: "#1D4ED8" }} />
                          QR table orders
                        </span>
                        <b>$7,210</b>
                      </div>
                      <div>
                        <span>
                          <i style={{ background: "var(--grn)" }} />
                          Website orders
                        </span>
                        <b>$4,692</b>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-lg-5">
                <div className="box">
                  <b>Missed-call recovery</b>
                  <div className="text-mut" style={{ fontSize: 13, margin: "4px 0 8px" }}>
                    Calls staff couldn't take before go-live (baseline month)
                  </div>
                  <div className="mc">
                    <span className="ic" style={{ background: "#FEECEC" }}>
                      📵
                    </span>
                    <span className="flex-grow-1">Calls missed</span>
                    <b>18</b>
                  </div>
                  <div className="mc">
                    <span className="ic" style={{ background: "#FEF3C7" }}>
                      🔁
                    </span>
                    <span className="flex-grow-1">Called back again</span>
                    <b>8</b>
                  </div>
                  <div className="mc">
                    <span className="ic" style={{ background: "#FEECEC" }}>
                      🏃
                    </span>
                    <span className="flex-grow-1">Ordered elsewhere</span>
                    <b>5</b>
                  </div>
                  <div className="mt-3 fw-semibold" style={{ background: "#ECFDF3", color: "#166534", padding: 12, borderRadius: 10, fontSize: 14 }}>
                    Now: 0 missed · est. $1,420 order value recovered
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="note text-center mt-3">Dashboard shown with sample data.</p>
        </div>
      </section>

      <section className="sec">
        <div className="container">
          <div className="row g-5 align-items-center dd">
            <div className="col-lg-6 order-2 order-lg-1">
              <div className="vis" style={{ background: "linear-gradient(150deg,#EEF3F8,#DFE8F2)" }}>
                <div className="map">
                  <div className="pin" style={{ left: 60, top: 50 }}>
                    Midtown · 3.9 km
                  </div>
                  <div className="pin on" style={{ left: "40%", top: 170 }}>
                    ✓ Williamsburg · 1.2 km
                  </div>
                  <div className="pin" style={{ right: 30, top: 60 }}>
                    Astoria · 7.4 km
                  </div>
                  <div className="pin me" style={{ left: 120, bottom: 40 }}>
                    📍 Customer
                  </div>
                  <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
                    <path d="M175 300 Q 220 250 300 200" stroke="#F26A1B" strokeWidth="4" strokeDasharray="8 6" fill="none" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="col-lg-6 order-1 order-lg-2">
              <span className="eyebrow">Multi-location + Customer history</span>
              <h2>Run every location and know every guest.</h2>
              <p className="l">
                Orders route to the nearest location automatically. Each guest gets a profile with order history, favorites and visit frequency — so regulars feel like regulars.
              </p>
              <ul className="ticks">
                <li>Nearest-location routing for pickup & delivery</li>
                <li>Per-location menus, hours and availability</li>
                <li>One owner view across all locations</li>
                <li>Customer history, favorites & lifetime value</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="sec pt-0">
        <div className="container">
          <div className="sh">
            <span className="eyebrow">Keep your POS</span>
            <h2>We automate around what you already use.</h2>
            <p>No rip-and-replace. Ringtable handles calls, reservations, QR and online ordering — and your existing POS stays where it is.</p>
          </div>
          <div className="row g-3">
            {[
              ["📞 Phone line", "lv", "● Live"],
              ["📱 QR ordering", "lv", "● Live"],
              ["🌐 Website ordering", "lv", "● Live"],
              ["🖨️ Kitchen printer / KDS", "lv", "● Live"],
              ["📅 Reservations", "lv", "● Live"],
              ["✉️ SMS alerts", "sn", "● Rolling out"],
              ["🧾 Square", "sn", "● On roadmap"],
              ["🍞 Toast", "sn", "● On roadmap"],
              ["⭐ Clover", "sn", "● On roadmap"],
              ["💳 Stripe payments", "sn", "● On roadmap"],
              ["🛵 Delivery partners", "sn", "● On roadmap"],
              ["🎁 Loyalty", "sn", "● On roadmap"],
            ].map(([name, tone, status]) => (
              <div className="col-6 col-md-4 col-lg-2" key={name}>
                <div className="integ">
                  {name}
                  <small className={tone}>{status}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec pt-0" id="roi">
        <div className="container">
          <div className="sh">
            <span className="eyebrow">ROI Calculator</span>
            <h2>What are missed calls costing you?</h2>
            <p>Move the sliders to match your restaurant. Most owners are surprised.</p>
          </div>
          <RoiCalculator />
        </div>
      </section>

      <section className="sec cs" id="case">
        <div className="container">
          <div className="sh">
            <span className="eyebrow">Pilot Case Study</span>
            <h2>How a 3-location restaurant stopped missing orders.</h2>
            <p>One shared phone line, handwritten tickets and a paper reservation book — replaced in 7 days.</p>
          </div>
          <div className="csb row g-0">
            <div className="col-lg-6">
              <div className="csl">
                <div className="tag">INDEPENDENT · 3 LOCATIONS · CASUAL DINING</div>
                <h3>Royal Restaurant: every call answered, +38% phone revenue, zero new hires.</h3>
                <p>During Friday and weekend rush, calls went unanswered, orders were written by hand and deliveries were sent from the wrong location. Reservations lived in a notebook.</p>
                <p>They moved phone, QR and website ordering into one Order Engine with the AI Receptionist on the main line — while keeping their existing POS.</p>
                <div className="row g-3 mt-2">
                  <div className="col-4">
                    <div className="meta">
                      Locations<b>3</b>
                    </div>
                  </div>
                  <div className="col-4">
                    <div className="meta">
                      Go-live<b>7 days</b>
                    </div>
                  </div>
                  <div className="col-4">
                    <div className="meta">
                      Channels<b>Phone · QR · Web</b>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-lg-6">
              <div className="csr">
                <div className="row g-3">
                  <div className="col-6">
                    <div className="res">
                      <b>100%</b>
                      <span>Calls answered at peak</span>
                    </div>
                  </div>
                  <div className="col-6">
                    <div className="res">
                      <b>+38%</b>
                      <span>Revenue from phone orders</span>
                    </div>
                  </div>
                  <div className="col-6">
                    <div className="res">
                      <b>-62%</b>
                      <span>Order errors & remakes</span>
                    </div>
                  </div>
                  <div className="col-6">
                    <div className="res">
                      <b>78 hrs</b>
                      <span>Staff phone time saved / mo</span>
                    </div>
                  </div>
                </div>
                <div className="res mt-3" style={{ height: "auto" }}>
                  <b style={{ fontSize: 15, color: "var(--ink)" }}>Before vs after · weekly</b>
                  <div className="bar">
                    <label>Calls answered</label>
                    <div className="tr">
                      <i style={{ width: "64%", background: "#C9CED6" }} />
                    </div>
                    <span style={{ width: 40 }}>64%</span>
                  </div>
                  <div className="bar">
                    <label />
                    <div className="tr">
                      <i style={{ width: "100%", background: "var(--or)" }} />
                    </div>
                    <span style={{ width: 40 }}>100%</span>
                  </div>
                  <div className="bar">
                    <label>Repeat guests</label>
                    <div className="tr">
                      <i style={{ width: "22%", background: "#C9CED6" }} />
                    </div>
                    <span style={{ width: 40 }}>22%</span>
                  </div>
                  <div className="bar">
                    <label />
                    <div className="tr">
                      <i style={{ width: "41%", background: "var(--or)" }} />
                    </div>
                    <span style={{ width: 40 }}>41%</span>
                  </div>
                  <div className="d-flex gap-3 text-mut mt-2" style={{ fontSize: 12 }}>
                    <span>■ Before</span>
                    <span className="text-or">■ After Ringtable</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="quote">
            <div className="av">R</div>
            <div>
              <p>"Friday nights used to mean ringing phones and angry customers. Now every order lands in one inbox and goes straight to the kitchen."</p>
              <div className="mt-2 text-mut" style={{ fontSize: 14 }}>
                <b className="text-dark">Owner</b> · Royal Restaurant
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="audit">
        <div className="container">
          <div className="row g-5 align-items-center">
            <div className="col-lg-6">
              <span className="eyebrow">Free Missed-Call Audit</span>
              <h2 style={{ fontSize: "clamp(32px,3.6vw,46px)", lineHeight: 1.08, margin: "16px 0" }}>
                We'll call your restaurant like a real customer — and show you what we find.
              </h2>
              <p className="text-mut" style={{ fontSize: 18, lineHeight: 1.6 }}>
                At your busiest hours we try to book a table, place a pickup order and ask a menu question. You get a scored report in 48 hours — and a demo of the AI handling the same calls, on your own menu.
              </p>
              <div className="pilot">
                <b>🗽 NYC Founding Pilot Program</b> — Growth at $400/mo, locked for 1 year, direct line to our product team.
                <div className="spots">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i className="f" />
                  <i className="f" />
                  <i className="f" />
                  <i className="f" />
                </div>
                <div className="text-mut mt-1" style={{ fontSize: 12 }}>
                  6 of 10 pilot spots taken
                </div>
              </div>
              <a href="#demo" className="btn btn-or mt-4">
                Request My Free Audit →
              </a>
            </div>
            <div className="col-lg-6">
              <div className="report">
                <div className="d-flex align-items-center gap-3 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
                  <div className="ring" />
                  <div>
                    <b style={{ fontSize: 18 }}>Phone Experience Score</b>
                    <div className="text-mut" style={{ fontSize: 14 }}>
                      Sample audit · Fri 7:30 PM peak
                    </div>
                  </div>
                </div>
                <div className="ai2">
                  <span>Call 1 — Table for 4 tonight</span>
                  <span className="bad">Not answered</span>
                </div>
                <div className="ai2">
                  <span>Call 2 — Pickup order</span>
                  <span className="mid">Answered after 6 rings</span>
                </div>
                <div className="ai2">
                  <span>Call 3 — "What's in the chicken pasta?"</span>
                  <span className="mid">Put on hold 2 min</span>
                </div>
                <div className="ai2">
                  <span>Online ordering available</span>
                  <span className="bad">No</span>
                </div>
                <div className="ai2">
                  <span>Reservation booking online</span>
                  <span className="ok">Yes</span>
                </div>
                <div className="ai2 border-0">
                  <span>Estimated orders at risk / month</span>
                  <b>~140</b>
                </div>
                <div className="mt-2" style={{ background: "var(--navy)", color: "#fff", borderRadius: 12, padding: 14, fontSize: 14 }}>
                  💡 Recommendation: AI Receptionist on main line + QR ordering for 24 tables
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sec pt-0" id="how">
        <div className="container">
          <div className="sh">
            <span className="eyebrow">How It Works</span>
            <h2>From audit to live in 7 days.</h2>
          </div>
          <div className="row g-4">
            {[
              ["1", "Free audit & 10-min demo", "We mystery-call your restaurant, then show the AI taking the same calls on your menu.", "Day 1"],
              ["2", "Menu & tables loaded", "We structure your menu, modifiers, combos, hours, tables and locations.", "Day 2–4"],
              ["3", "AI trained & tested", "Your receptionist learns your FAQs and policies. You test-call it until you're happy.", "Day 5–6"],
              ["4", "Go live", "Forward your number, place QR codes, and watch orders land in one inbox.", "Day 7"],
            ].map(([n, title, body, time]) => (
              <div className="col-md-6 col-lg-3" key={n}>
                <div className="cardx st">
                  <div className="n">{n}</div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <div className="t">{time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec pt-0" id="pricing">
        <div className="container">
          <div className="sh">
            <span className="eyebrow">Pricing</span>
            <h2>Simple plans. Setup included.</h2>
            <p>Every plan includes menu setup, AI training and the One Order Inbox. Monthly or yearly. Cancel anytime.</p>
            <div className="bill-toggle" role="group" aria-label="Billing period">
              <button type="button" className={billingInterval === "month" ? "on" : ""} onClick={() => setBillingInterval("month")}>
                Monthly
              </button>
              <button type="button" className={billingInterval === "year" ? "on" : ""} onClick={() => setBillingInterval("year")}>
                Yearly 
              </button>
            </div>
          </div>
          <div className="row g-4 align-items-stretch">
            <div className="col-lg-4">
              <div className="cardx pp">
                <h3>Starter</h3>
                <p className="text-mut mt-1 mb-0">1 location</p>
                <div className="pz">
                  {formatPlanPrice(planAmount("starter", billingInterval))}
                  <small>/{billingInterval === "year" ? "yr" : "mo"}</small>
                </div>
                <p className="price-note">{billingInterval === "year" ? BILLING_PLANS.starter.yearlyNote : "\u00a0"}</p>
                <ul>
                  {BILLING_PLANS.starter.highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <Link to={`/signup?plan=starter&interval=${billingInterval}`} className="btn btn-ghost w-100">
                  Sign up {billingInterval === "year" ? "yearly" : "monthly"}
                </Link>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="cardx pp hot">
                <div className="d-flex justify-content-between align-items-center">
                  <h3>Growth</h3>
                  <span className="eyebrow" style={{ background: "var(--or)", color: "#fff", fontSize: 11 }}>
                    Most popular
                  </span>
                </div>
                <p className="mt-1 mb-0" style={{ color: "#9AA6B8" }}>
                  ${BILLING_PLANS.growth.monthly}/mo · up to 5 locations
                </p>
                <div className="pz">
                  {formatPlanPrice(planAmount("growth", billingInterval))}
                  <small style={{ color: "#9AA6B8" }}>/{billingInterval === "year" ? "yr" : "mo"}</small>
                </div>
                <p className="price-note">{billingInterval === "year" ? BILLING_PLANS.growth.yearlyNote : "\u00a0"}</p>
                <ul>
                  {BILLING_PLANS.growth.highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <Link to={`/signup?plan=growth&interval=${billingInterval}`} className="btn btn-or w-100">
                  Sign up {billingInterval === "year" ? "yearly" : "monthly"}
                </Link>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="cardx pp">
                <h3>Pilot</h3>
                <p className="text-mut mt-1 mb-0">Growth for 1 year</p>
                <div className="pz">
                  {formatPlanPrice(planAmount("pilot", billingInterval))}
                  <small>/{billingInterval === "year" ? "yr" : "mo"}</small>
                </div>
                <p className="price-note">{billingInterval === "year" ? BILLING_PLANS.pilot.yearlyNote : "\u00a0"}</p>
                <ul>
                  {BILLING_PLANS.pilot.highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <Link to={`/signup?plan=pilot&interval=${billingInterval}`} className="btn btn-ghost w-100">
                  Sign up {billingInterval === "year" ? "yearly" : "monthly"}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sec pt-0" id="faq">
        <div className="container" style={{ maxWidth: 900 }}>
          <div className="sh">
            <span className="eyebrow">FAQ</span>
            <h2>Straight answers to real objections.</h2>
          </div>
          <div>
            {FAQS.map((item, index) => {
              const open = openFaq === index;
              return (
                <div className="accordion-item" key={item.q}>
                  <h3>
                    <button
                      className={`accordion-button${open ? " open" : ""}`}
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenFaq(open ? -1 : index)}
                    >
                      {item.q}
                    </button>
                  </h3>
                  {open && <div className="accordion-body">{item.a}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="demo">
        <div className="container">
          <div className="cta">
            <div className="row g-5 align-items-start">
              <div className="col-lg-6">
                <h2>Every customer channel. Every order. One restaurant operating system.</h2>
                <p>Book a 10-minute demo built on your actual menu. We'll call the AI live, walk through your inbox and dashboard, and send your free Missed-Call Audit.</p>
                <div className="row g-3 mt-2">
                  {[
                    ["✓ No POS change", "Keep what you use today"],
                    ["✓ Live in 7 days", "We do the setup"],
                    ["✓ Your menu, your voice", "Not a generic bot"],
                    ["✓ Cancel anytime", "No long contracts"],
                  ].map(([title, body]) => (
                    <div className="col-6" key={title}>
                      <div className="tb">
                        <b>{title}</b>
                        {body}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="col-lg-6">
                <DemoForm />
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="container">
          <div className="row g-4">
            <div className="col-lg-4">
              <a className="brand" href="#top" aria-label={PRODUCT_NAME}>
                <BrandMark variant="wordmark" />
              </a>
              <p className="mt-3" style={{ lineHeight: 1.6, fontSize: 14, maxWidth: 300 }}>
                The AI restaurant operating system for independent restaurants.
              </p>
            </div>
            <div className="col-6 col-lg-2 offset-lg-1">
              <h5>Product</h5>
              <ul>
                <li><a href="#engine">One Order Engine</a></li>
                <li><a href="#ai">AI Receptionist</a></li>
                <li><a href="#engine">QR Ordering</a></li>
                <li><a href="#ai">Reservations</a></li>
                <li><a href="#results">Owner Dashboard</a></li>
              </ul>
            </div>
            <div className="col-6 col-lg-2">
              <h5>Resources</h5>
              <ul>
                <li><a href="#audit">Free Missed-Call Audit</a></li>
                <li><a href="#roi">ROI Calculator</a></li>
                <li><a href="#audit">Pilot Program</a></li>
                <li><a href="#case">Case Studies</a></li>
              </ul>
            </div>
            <div className="col-6 col-lg-3">
              <h5>Get in touch</h5>
              <ul>
                <li>
                  <a href={`mailto:${PRODUCT_EMAIL}`}>{PRODUCT_EMAIL}</a>
                </li>
                <li>Washington, DC</li>
                <li><a href="#demo">Book a demo</a></li>
              </ul>
            </div>
          </div>
          <div className="d-flex justify-content-between flex-wrap gap-2 mt-4 pt-4" style={{ borderTop: "1px solid var(--line2)", fontSize: 13 }}>
            <span>© {new Date().getFullYear()} {PRODUCT_NAME}. All rights reserved.</span>
            <span>
              <a href="#top">Privacy</a> · <a href="#top">Terms</a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
