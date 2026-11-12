
/* Public BENPAL EDUCATION CENTRE pages connected to the secure backend. */
const $ = (selector) => document.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"\x27]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "\x27": "&#39;" }[char]));
const themes = [["blue", "Blue", "#1f5fd1"], ["red", "Red", "#c62828"], ["grey", "Grey", "#4b5563"]];
function setTheme(name) { if (themes.some(([id]) => id === name)) { document.documentElement.dataset.t = name; localStorage.setItem("bp_theme", name); } }
try { setTheme(localStorage.getItem("bp_theme") || "blue"); } catch (_) {}
function themeButtons() { return `<span class="th np">${themes.map(([id, label, colour]) => `<button type="button" class="sw" data-theme="${id}" aria-label="${label} theme" title="${label} theme" style="background:${colour}"></button>`).join("")}</span>`; }
document.addEventListener("click", (event) => { const button = event.target.closest("[data-theme]"); if (button) setTheme(button.dataset.theme); });

async function api(url, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...requestOptions,
    headers: { "Content-Type": "application/json", ...headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The school server could not complete that request.");
  return data;
}
async function csrfToken() { return (await api("/api/csrf")).csrfToken; }
function message(text, error = false) { const box = $("#fm"); if (!box) return; box.className = `msg${error ? " e" : ""}`; box.textContent = text; }
function pageShell(content, current = "home") {
  const pages = [["home", "Home"], ["about", "About us"], ["academics", "Academics"], ["admissions", "Admissions"], ["fees", "Fee payments"], ["reports", "Report forms"], ["contact", "Contact"]];
  $("#root").innerHTML = `<header class="ph np"><b>BENPAL EDUCATION CENTRE</b><div class="pn">${pages.map(([id, name]) => `<a href="#${id}" class="${id === current ? "on" : ""}">${name}</a>`).join("")}${themeButtons()}<a class="cta" href="/login.html">Staff sign in</a></div></header><main class="pm">${content}</main><footer class="pf">© ${new Date().getFullYear()} BENPAL EDUCATION CENTRE · <a href="#contact">Contact</a></footer>`;
}
function publicPage(name) {
  const pages = {
    home: `<section class="hero"><div><h1>Learning that builds the whole child</h1><p>BENPAL EDUCATION CENTRE is a day school for Grades 1 to 6 in Nairobi.</p><a href="#admissions">Apply for a place</a><a class="alt" href="#fees">Fee information</a></div></section><div class="row"><div class="card"><h3>Admissions</h3><p>Send an application to the admissions office. It will be reviewed by authorised staff.</p></div><div class="card"><h3>Fee records</h3><p>Verified payments and fee balances are managed securely by the school.</p></div><div class="card"><h3>Follow progress</h3><p>Parent access will be added after the school verifies its process.</p></div></div>`,
    about: `<h2>About BENPAL EDUCATION CENTRE</h2><div class="card"><p>We are a school where every learner is known by name.</p><h3>Our mission</h3><p>To give every learner a safe place to grow in knowledge, skill and confidence.</p></div>`,
    academics: `<h2>Academics</h2><div class="card"><h3>Subjects</h3><p>Maths, English, Kiswahili, Science, Social Studies, Creative Arts, Physical Education and Computer Studies.</p></div>`,
    admissions: `<h2>Admissions</h2><form id="admission-form" class="card"><p class="note">Your application will be sent securely to the school admissions team for review.</p><div class="row"><div><label for="child">Child’s full name</label><input id="child" required maxlength="60"></div><div><label for="dob">Date of birth</label><input id="dob" type="date" required></div><div><label for="class">Applying for</label><select id="class"><option>Grade 1</option><option>Grade 2</option><option>Grade 3</option><option>Grade 4</option><option>Grade 5</option><option>Grade 6</option></select></div></div><div class="row"><div><label for="guardian">Parent or guardian name</label><input id="guardian" required maxlength="60"></div><div><label for="phone">Phone</label><input id="phone" required inputmode="tel" placeholder="0712345678"></div></div><button class="b">Submit application</button><div id="fm" role="status"></div></form>`,
    fees: `<h2>Pay school fees</h2><form id="mpesa-form" class="card"><p>Enter the learner number, guardian phone and amount. We will send an M-Pesa prompt to that phone.</p><p class="note">Enter the M-Pesa PIN only on the phone prompt. BENPAL EDUCATION CENTRE never asks for or stores your PIN.</p><div class="row"><div><label for="fee-student">Learner number</label><input id="fee-student" required maxlength="14" autocapitalize="characters" placeholder="BEN- or BEC-XXXXXXXXXX"></div><div><label for="fee-phone">M-Pesa phone number</label><input id="fee-phone" required inputmode="tel" placeholder="0712345678"></div><div><label for="fee-amount">Amount (KES)</label><input id="fee-amount" required type="number" min="1" max="150000" step="1" inputmode="numeric"></div></div><button class="b">Send M-Pesa prompt</button><div id="fm" role="status"></div></form>`,
    reports: `<h2>Report forms</h2><div class="card"><p>Parent report access will be connected after secure parent accounts and teacher report workflows are complete.</p></div>`,
    contact: `<h2>Contact us</h2><div class="card"><p>Please contact the school office for admissions, fee support, or academic enquiries.</p></div>`
  };
  pageShell(pages[name] || pages.home, name);
  if (name === "admissions") wireAdmission();
  if (name === "fees") wireMpesaPayment();
}
function wireAdmission() {
  $("#admission-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const guardianPhone = $("#phone").value.trim();
    if (!/^(07|01)\d{8}$/.test(guardianPhone)) return message("Enter a valid Kenyan phone number.", true);
    try {
      const token = await csrfToken();
      await api("/api/admissions", { method: "POST", headers: { "x-csrf-token": token }, body: JSON.stringify({ childName: $("#child").value.trim(), dateOfBirth: $("#dob").value, applyingFor: $("#class").value, guardianName: $("#guardian").value.trim(), guardianPhone }) });
      $("#admission-form").reset();
      message("Application received. The admissions office will review it.");
    } catch (error) { message(error.message, true); }
  });
}
function wireMpesaPayment() {
  let statusTimer;
  const pollStatus = async (requestId, attempt = 0) => {
    if (attempt >= 10) return message("Payment is still pending. Please wait for the M-Pesa confirmation before trying again.");
    try {
      const { payment } = await api(`/api/public/mpesa/status/${encodeURIComponent(requestId)}`);
      if (payment.status === "succeeded") return message("Payment confirmed. Your fee payment has been recorded.");
      if (payment.status === "failed") return message(payment.result_description || "The M-Pesa payment was not completed.", true);
      if (payment.status === "review") return message("Payment received and awaiting school review. Do not pay again.", true);
      statusTimer = window.setTimeout(() => pollStatus(requestId, attempt + 1), 5000);
    } catch (_) { statusTimer = window.setTimeout(() => pollStatus(requestId, attempt + 1), 5000); }
  };
  $("#mpesa-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    window.clearTimeout(statusTimer);
    const studentNumber = $("#fee-student").value.trim().toUpperCase();
    const phoneNumber = $("#fee-phone").value.trim();
    const amountKes = $("#fee-amount").value;
    if (!/^(?:BEN|BEC)-[A-Z0-9]{10}$/.test(studentNumber)) return message("Enter the learner number in the format BEN-XXXXXXXXXX or BEC-XXXXXXXXXX.", true);
    if (!/^(?:254|0)(?:7|1)\d{8}$/.test(phoneNumber)) return message("Enter a valid Kenyan M-Pesa phone number.", true);
    if (!/^[1-9]\d*$/.test(amountKes)) return message("Enter a whole amount greater than zero.", true);
    const button = $("#mpesa-form button");
    button.disabled = true;
    try {
      const token = await csrfToken();
      const result = await api("/api/public/mpesa/stk-push", { method: "POST", headers: { "x-csrf-token": token }, body: JSON.stringify({ studentNumber, phoneNumber, amountKes }) });
      message(result.message || "Check the phone for the M-Pesa prompt. Enter the PIN only on the phone.");
      pollStatus(result.requestId);
    } catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
}
function route() { const page = location.hash.slice(1) || "home"; publicPage(["home", "about", "academics", "admissions", "fees", "reports", "contact"].includes(page) ? page : "home"); }
window.addEventListener("hashchange", route); route();
