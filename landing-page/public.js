const app = document.querySelector('#publicApp');

function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const menu = [
  ['Crispy Pata', 'Main Course', 680, 'Slow-roasted pork knuckle with our house soy-calamansi dip.', 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=85'],
  ['Chicken Inasal', 'Main Course', 320, 'Char-grilled chicken marinated in lemongrass, calamansi, and annatto oil.', 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=85'],
  ['Beef Kare-Kare', 'Main Course', 495, 'Tender beef simmered in a rich peanut sauce with seasonal vegetables.', 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=85'],
  ['Grilled Seafood', 'Main Course', 790, 'A generous catch of prawns, squid, and fish finished over live fire.', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=800&q=85'],
  ['Halo-Halo', 'Desserts', 220, 'Shaved ice, tropical fruits, leche flan, and ube cream.', 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=800&q=85'],
  ['Calamansi Spritz', 'Beverages', 180, 'Bright calamansi, sparkling water, and a hint of basil.', 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=85']
];
const money = value => `₱${value.toLocaleString('en-PH')}`;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
function setPublicButtonBusy(button, label) {
  if (!button || button.disabled) return null;
  const originalContent = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  const slowTimer = window.setTimeout(() => {
    if (button.isConnected && button.disabled) button.textContent = 'Still processing…';
  }, 5000);
  return () => {
    window.clearTimeout(slowTimer);
    if (!button.isConnected) return;
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.innerHTML = originalContent;
  };
}
function publicReservationTimeOptions(date, selectedTime = '') {
  return window.CostTrackLogic.reservationTimeSlots(date)
    .map(time => `<option value="${time}" ${selectedTime === time ? 'selected' : ''}>${time}</option>`)
    .join('');
}
function refreshPublicReservationTimeOptions(form) {
  const select = form.elements.time;
  const selectedTime = select.value;
  const slots = window.CostTrackLogic.reservationTimeSlots(form.elements.date.value);
  select.innerHTML = `<option value="" selected disabled>Choose a time</option>${publicReservationTimeOptions(form.elements.date.value, selectedTime)}`;
  if (slots.includes(selectedTime)) select.value = selectedTime;
}
function refreshPublicReservationGuestTotal(form) {
  const total = form.querySelector('[data-guest-total]');
  const errorMessage = form.querySelector('[data-guest-count-error]');
  try {
    const counts = window.CostTrackLogic.normalizeReservationGuestCounts(
      form.elements.adults.value,
      form.elements.seniorPwdCount.value,
      form.elements.children.value
    );
    total.value = counts.total;
    total.textContent = counts.total;
    errorMessage.hidden = true;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    total.value = '';
    total.textContent = '—';
    errorMessage.hidden = false;
  }
}
const publicReservationCooldownMs = 60 * 1000;
const publicReservationCooldownKey = 'isobel_public_reservation_cooldown';
function publicReservationCooldownRemaining() {
  return Math.max(0, Number(sessionStorage.getItem(publicReservationCooldownKey) || 0) - Date.now());
}
function publicReservationError(error) {
  const message = String(error?.message || error || '');
  if (/rate limit|unable to process reservation request/i.test(message)) return 'We received several requests from this contact recently. Please wait a minute and try again.';
  if (/reservation start time has already passed|cannot be scheduled in the past/i.test(message)) return 'That reservation time has already passed. Choose a later time.';
  if (/reservation time must be within restaurant hours|two-hour reservation window/i.test(message)) return 'Choose a start time from 10:00 AM through 7:00 PM so your two-hour seating window ends by closing at 9:00 PM.';
  if (/guest counts|reservation must include between/i.test(message)) return 'Enter non-negative whole-number guest counts and include at least one guest.';
  return 'We could not submit your reservation. Please check your details and try again.';
}

function header(active) {
  const links = [['home','Home'],['about','About Us'],['menu','Menu'],['buffet','Buffet'],['gallery','Ambience'],['contact','Contact']];
  return `<header><a class="logo" href="#home" data-page="home"><img class="logo-image" src="../images/isobel_logo.jpg" alt="Isobel Buffet Restaurant"></a><nav>${links.map(([id,label]) => `<a class="${active === id ? 'active' : ''}" href="#${id}" data-page="${id}">${label}</a>`).join('')}</nav><div class="header-actions"><button class="book" data-page="reservation">Reserve a table</button><button class="menu-toggle">☰</button></div></header>`;
}
function footer() { return `<footer><div><div class="logo"><img class="logo-image" src="../images/isobel_logo.jpg" alt="Isobel Buffet Restaurant"></div><p>Thoughtful food. Unhurried moments.<br>Made for your table.</p></div><div><b>Visit us</b><span>City Park Avenue, Sabang, Lipa City, Batangas</span><span>0975 888 6567</span></div><div><b>Hours</b><span>Monday – Sunday</span><span>10:00 AM – 9:00 PM</span></div><div><b>Contact</b><span>glad_sarabia@yahoo.com</span></div></footer>`; }
function shell(active, content) { return `${header(active)}${content}${footer()}`; }
function home() {
  return shell('home', `<section class="hero"><div class="hero-copy"><small>A table worth gathering around</small><h1>Exceptional dining,<br><em>memorable moments.</em></h1><p>Welcome to ISOBEL, where Filipino soul meets modern hospitality. Come hungry, stay awhile.</p><div class="actions"><button class="primary" data-page="menu">Explore our menu</button><button class="outline" data-page="reservation">Reserve your table</button></div><i>✦ Open daily · 10:00 AM – 9:00 PM</i></div><div class="hero-photo"><img src="../images/isobel-table.png" alt="Isobel dining room"></div></section><section class="intro"><div class="intro-copy"><h2>Food that feels like<br><em>coming home.</em></h2><p>From heirloom recipes to ingredients sourced at their peak, every plate tells a story of the islands. We create spaces for celebrations, conversations, and the simple joy of sharing a meal.</p><button class="link" data-page="about">Discover our story</button></div><img class="intro-image" src="https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=85" alt="Placeholder food photo"></section><section class="section featured"><small>From our kitchen</small><h2>House <em>favorites</em></h2><div class="cards">${menu.slice(0,3).map(dishCard).join('')}</div></section><section class="quote"><b>“</b><blockquote>There is no love more sincere than the love of food.</blockquote><span>— George Bernard Shaw</span></section><section class="cta"><div><small>Your table awaits</small><h2>Make tonight<br><em>memorable.</em></h2></div><button class="outline light" data-page="reservation">Reserve your table</button></section>`);
}
function dishCard(d) { return `<article><img src="${d[4]}" alt="${d[0]}"><div><small>${d[1]}</small><h3>${d[0]}</h3><p>${d[3]}</p><b>${money(d[2])}</b></div></article>`; }
function about() { return shell('about', `<section class="inner-hero"><small>Our story</small><h1>Rooted in home.<br><em>Made for here.</em></h1><p>ISOBEL is a love letter to the flavors, people, and places that shaped us.</p></section><section class="split"><div><small>The beginning</small><h2>A table set<br>with <em>intention.</em></h2><p>ISOBEL began with a simple belief: the best meals are the ones that bring people closer. Our kitchen takes the comfort of Filipino cooking and gives it a fresh, thoughtful point of view.</p><p>Every detail is an invitation to slow down and stay awhile.</p></div><img src="https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1000&q=85" alt="ISOBEL dining space"></section><section class="values"><small>What guides us</small><div class="value-grid">${[['01','Generosity','We believe a table should always have room for one more.'],['02','Integrity','We honor ingredients, traditions, and the hands behind them.'],['03','Joy','We make space for the little celebrations that make life delicious.']].map(v=>`<div><span>${v[0]}</span><h3>${v[1]}</h3><p>${v[2]}</p></div>`).join('')}</div></section>`); }
function menuPage() { return shell('menu', `<section class="inner-hero menu-hero"><small>The menu</small><h1>Flavors with<br><em>a point of view.</em></h1><p>Filipino favorites, reimagined with seasonal ingredients and a little ISOBEL magic.</p></section><section class="section menu-page"><div class="filters">${['All dishes','Main Course','Appetizers','Desserts','Beverages','Buffet Specials'].map((c,i)=>`<button class="${i?'':'active'}" data-filter="${c}">${c}</button>`).join('')}</div><div class="menu-grid">${menu.map(dishCard).join('')}</div></section>`); }
function buffet() { const packs = [['Silver','499',['Main dishes','Desserts','Unlimited drinks']],['Gold','799',['Premium menu selection','Seafood options','Desserts','Unlimited drinks']],['Platinum','999',['Full buffet experience','Premium menu','VIP seating','Unlimited drinks']]]; return shell('buffet', `<section class="inner-hero buffet-hero"><small>Gather generously</small><h1>There is always<br><em>room for more.</em></h1><p>Our buffet packages are made for birthdays, reunions, and the stories that happen around a full table.</p></section><section class="section"><small>Choose your experience</small><h2>Made for <em>your gathering.</em></h2><div class="packages">${packs.map((p,i)=>`<article class="${i===1?'featured':''}"><small>${p[0]} package</small><h3>₱${p[1]} <i>per person</i></h3><p>A generous spread for easy, joyful gatherings.</p><ul>${p[2].map(f=>`<li>✓ ${f}</li>`).join('')}</ul><button class="${i===1?'primary':'outline'}" data-page="reservation">Choose ${p[0]} ↗</button></article>`).join('')}</div></section>`); }
function reservation() {
  return shell('reservation', `<section class="form-hero"><div><small>A seat at our table</small><h1>Reserve your<br><em>moment.</em></h1><p>Tell us a little about your visit and we will take care of the rest.</p></div><img src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1000&q=85" alt="Set restaurant table"></section><section class="form-layout"><form id="reservationForm"><label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><small>Reservation details</small><h2>Let's make it <em>special.</em></h2><div class="form-row"><label>Full name<input name="name" required placeholder="Your full name"></label><label>Contact number<input name="phone" required placeholder="09XX XXX XXXX"></label></div><label>Email address<input name="email" type="email" required placeholder="you@email.com"></label><fieldset class="guest-count-fields"><legend>Number of guests</legend><div class="guest-count-row"><label>Adults<input id="reservationAdults" name="adults" type="number" min="0" max="1000" step="1" value="2" required></label><label>Senior / PWD<input id="reservationSeniorPwdCount" name="seniorPwdCount" type="number" min="0" max="1000" step="1" value="0" required></label><label>Kids<input id="reservationChildren" name="children" type="number" min="0" max="1000" step="1" value="0" required></label></div><p class="guest-total">Total guests: <output data-guest-total for="reservationAdults reservationSeniorPwdCount reservationChildren" aria-live="polite">2</output><span data-guest-count-error hidden> Enter whole-number counts and include at least one guest.</span></p></fieldset><div class="form-row"><label>Reservation date<input name="date" type="date" required></label><label>Reservation time<select name="time" required><option value="" selected disabled>Choose a time</option>${publicReservationTimeOptions()}</select><small>Each reservation has a two-hour seating window. Choose a start from 10:00 AM through 7:00 PM so it ends by closing at 9:00 PM. Past times today are unavailable.</small></label></div><label>Occasion<select name="occasion"><option>Birthday</option><option>Anniversary</option><option>Family gathering</option><option>Business meeting</option></select></label><label>Special requests<textarea name="requests" rows="4" placeholder="Dietary requirements or seating preferences"></textarea></label><button class="primary">Request reservation ↗</button></form><aside><small>Good to know</small><h3>We hold your table for 15 minutes after your reservation time.</h3><p>Enter every guest by category above. The total updates automatically, including for large parties.</p><button class="link" data-page="status">Check reservation status →</button></aside></section>`);
}
function status() { return shell('status', `<section class="inner-hero status-hero"><small>Your reservation</small><h1>We saved you<br><em>a seat.</em></h1><p>Enter your reservation reference below to see the latest update.</p></section><section class="status-section"><form id="statusForm"><label>Reservation number<input name="reference" value="RES-2026-001" placeholder="RES-2026-001"></label><button class="primary">Check status ↗</button></form><div id="statusResult" role="status" aria-live="polite"></div></section>`); }
function gallery() { const pics = [['Dining area','https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1000&q=85'],['Private rooms','https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1000&q=85'],['Signature dishes','https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1000&q=85'],['The buffet','https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=1000&q=85'],['Good company','https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1000&q=85'],['Little celebrations','https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=1000&q=85']]; return shell('gallery', `<section class="inner-hero gallery-hero"><small>A glimpse inside</small><h1>Gather beautifully.<br><em>Stay awhile.</em></h1></section><section class="gallery">${pics.map(p=>`<figure><img src="${p[1]}" alt="${p[0]}"><figcaption>${p[0]} <b>↗</b></figcaption></figure>`).join('')}</section>`); }
function contact() { return shell('contact', `<section class="inner-hero"><small>Come find us</small><h1>Let's make<br><em>plans.</em></h1><p>Questions, celebrations, or just a hello—we would love to hear from you.</p></section><section class="contact"><div><small>ISOBEL restaurant</small><h2>Good food is<br><em>better shared.</em></h2><div class="contact-lines"><div><b>Visit us</b><span>City Park Avenue, Sabang, Lipa City, </span><span>Batangas</span></div><div><b>Call or email</b><span>0975 888 6567</span><span>glad_sarabia@yahoo.com</span></div><div><b>Hours</b><span>Monday – Sunday</span><span>10:00 AM – 9:00 PM</span></div></div></div><form id="contactForm"><small>Send a note</small><label>Name<input required placeholder="Your name"></label><label>Email<input type="email" required placeholder="you@email.com"></label><label>Message<textarea required rows="5" placeholder="How can we help?"></textarea></label><button class="primary">Send message ↗</button></form></section>`); }
const pages = { home, about, menu: menuPage, buffet, reservation, status, gallery, contact };
function render(page = location.hash.slice(1) || 'home') {
  app.innerHTML = pages[page] ? pages[page]() : pages.home();
  const date = document.querySelector('#reservationForm [name="date"]');
  const reservationForm = document.querySelector('#reservationForm');
  if (date) {
    date.min = localDateStr(new Date());
    date.closest('form').addEventListener('change', event => {
      if (event.target.matches('[name="date"]')) refreshPublicReservationTimeOptions(event.currentTarget);
    });
  }
  if (reservationForm) {
    refreshPublicReservationGuestTotal(reservationForm);
    reservationForm.addEventListener('input', event => {
      if (event.target.matches('[name="adults"],[name="seniorPwdCount"],[name="children"]')) {
        refreshPublicReservationGuestTotal(reservationForm);
      }
    });
  }
  const statusForm = document.querySelector('#statusForm');
  if (statusForm) {
    statusForm.querySelector('input[name="reference"]').value = '';
    const contact = document.createElement('label');
    contact.innerHTML = 'Email or contact number<input name="contact" required autocomplete="email" placeholder="Contact used for the reservation">';
    statusForm.insertBefore(contact, statusForm.querySelector('button'));
  }
  bind();
  window.scrollTo(0, 0);
}
function bind() {
  document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', event => { event.preventDefault(); location.hash = el.dataset.page; }));
  document.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === el)); document.querySelectorAll('.menu-grid article').forEach(item => item.hidden = el.dataset.filter !== 'All dishes' && !item.querySelector('small').textContent.includes(el.dataset.filter)); }));
  const reservationForm = document.querySelector('#reservationForm');
  if (reservationForm && !reservationForm.elements.website) reservationForm.insertAdjacentHTML('afterbegin', '<label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>');
  reservationForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (formElement.dataset.saving === 'true') return;
    const form = new FormData(formElement);
    if (window.CostTrackLogic.reservationStartTimeIsInPast(form.get('date'), form.get('time'))) {
      let message = formElement.querySelector('.form-error');
      if (!message) {
        message = document.createElement('p');
        message.className = 'form-error';
        message.setAttribute('role', 'alert');
        formElement.prepend(message);
      }
      message.textContent = 'That reservation time has already passed. Choose a later time.';
      return;
    }
    if (publicReservationCooldownRemaining()) {
      const seconds = Math.ceil(publicReservationCooldownRemaining() / 1000);
      let cooldownMessage = formElement.querySelector('.form-error');
      if (!cooldownMessage) {
        cooldownMessage = document.createElement('p');
        cooldownMessage.className = 'form-error';
        cooldownMessage.setAttribute('role', 'alert');
        formElement.prepend(cooldownMessage);
      }
      cooldownMessage.textContent = `Please wait ${seconds} seconds before submitting another reservation.`;
      return;
    }
    const submit = formElement.querySelector('button[type="submit"],button:not([type])');
    const restoreButton = setPublicButtonBusy(submit, 'Sending reservation…');
    if (!restoreButton) return;
    formElement.dataset.saving = 'true';
    try {
      const guestCounts = window.CostTrackLogic.normalizeReservationGuestCounts(
        form.get('adults'),
        form.get('seniorPwdCount'),
        form.get('children')
      );
      const reservation = await window.supabaseRecord.submitPublicReservation({
        name: String(form.get('name')).trim(),
        email: String(form.get('email')).trim(),
        phone: String(form.get('phone')).trim(),
        date: form.get('date'),
        time: form.get('time'),
        adults: guestCounts.adults,
        seniorPwdCount: guestCounts.seniorPwdCount,
        children: guestCounts.children,
        guests: guestCounts.total,
        occasion: form.get('occasion'),
        request: form.get('requests'),
        website: form.get('website')
      });
      const reference = typeof reservation === 'string' ? reservation : reservation.id || reservation.reference;
      if (!reference) throw new Error('The reservation was submitted but no reference was returned.');
      const email = String(form.get('email')).trim();
      formElement.innerHTML = `<div class="success"><span aria-hidden="true">✦</span><small>Reservation request received</small><h2>Thank you, ${escapeHTML(String(form.get('name')).trim().split(' ')[0])}.</h2><p>Your table request is with our team. It is not confirmed until the restaurant approves it.</p><b>${escapeHTML(reference)}</b><p id="reservationReferenceEmailNotice" role="status" aria-live="polite">Sending your reservation reference to ${escapeHTML(email)}…</p><button class="link" data-page="status">Check reservation status →</button></div>`;
      sessionStorage.setItem(publicReservationCooldownKey, String(Date.now() + publicReservationCooldownMs));
      bind();
      void window.supabaseRecord.sendPublicReservationReference(reference, email)
        .then(() => {
          const notice = document.querySelector('#reservationReferenceEmailNotice');
          if (notice) notice.textContent = `We sent the reference to ${email}.`;
        })
        .catch(error => {
          console.error('Reservation was saved, but its reference email could not be sent.', error);
          const notice = document.querySelector('#reservationReferenceEmailNotice');
          if (notice) notice.textContent = 'We could not email the reference. Please save it so you can check your reservation status.';
        });
    } catch (error) {
      console.error('Public reservation could not be submitted.', error);
      let message = formElement.querySelector('.form-error');
      if (!message) {
        message = document.createElement('p');
        message.className = 'form-error';
        message.setAttribute('role', 'alert');
        formElement.prepend(message);
      }
      message.textContent = publicReservationError(error);
    } finally {
      delete formElement.dataset.saving;
      restoreButton();
    }
  });
  document.querySelector('#statusForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (formElement.dataset.loading === 'true') return;
    const form = new FormData(formElement);
    const submit = formElement.querySelector('button[type="submit"],button:not([type])');
    const restoreButton = setPublicButtonBusy(submit, 'Checking reservation…');
    if (!restoreButton) return;
    formElement.dataset.loading = 'true';
    const result = document.querySelector('#statusResult');
    result.textContent = 'Checking reservation…';
    try {
      const response = await window.supabaseRecord.getPublicReservationStatus(
        String(form.get('reference')).trim().toUpperCase(),
        String(form.get('contact')).trim()
      );
      const reservation = Array.isArray(response) ? response[0] : response;
      result.innerHTML = reservation ? `<div class="status-card"><div><small>Reservation found</small><h2>Your reservation is <em>on file.</em></h2></div><strong class="badge ${escapeHTML(String(reservation.status).toLowerCase())}">● ${escapeHTML(reservation.status)}</strong><div class="status-details"><span>Reference<b>${escapeHTML(reservation.id || reservation.reference)}</b></span><span>Date & time<b>${escapeHTML(reservation.date || reservation.reservation_date)}<br>${escapeHTML(reservation.time || reservation.reservation_time)}</b></span><span>Guests<b>${escapeHTML(reservation.guests)} persons</b></span></div></div>` : '<div class="empty"><h3>We could not find that reservation.</h3><p>Check the reference and contact details, then try again.</p></div>';
    } catch (error) {
      console.error('Reservation status lookup failed.', error);
      result.innerHTML = '<div class="empty" role="alert"><h3>We could not check that reservation.</h3><p>Please try again when your connection is available.</p></div>';
    } finally {
      delete formElement.dataset.loading;
      restoreButton();
    }
  });
  document.querySelector('#contactForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    let message = form.querySelector('.form-error');
    if (!message) {
      message = document.createElement('p');
      message.className = 'form-error';
      message.setAttribute('role', 'alert');
      form.prepend(message);
    }
    message.textContent = 'This contact form is not connected, so your message was not sent. Please use the restaurant contact details in the footer.';
  });
}
window.addEventListener('hashchange', () => render());
render();
