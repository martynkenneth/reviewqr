// The business details form, shared by first-time setup and Settings. It
// includes a live preview of the customer screen (updated by app.js).
const { html } = require('../html');
const { DEFAULT_COLOUR } = require('../lib/colour');

const SWATCHES = ['#0f766e', '#1d4ed8', '#0369a1', '#15803d', '#b91c1c', '#c2410c', '#ca8a04', '#7c3aed', '#be185d', '#111827'];

function businessForm(req, { action, values = {}, error, submitLabel, logoUrl }) {
  const colour = values.brand_colour || DEFAULT_COLOUR;
  const custom = !SWATCHES.includes(colour);
  return html`<form method="post" action="${action}" enctype="multipart/form-data" class="stack business-form" data-business-form>
    <input type="hidden" name="_csrf" value="${req.csrfToken}" />
    ${error ? html`<p class="alert alert-error" role="alert">${error}</p>` : ''}

    <label
      >Business name
      <input name="name" value="${values.name || ''}" maxlength="80" required placeholder="e.g. ABC Plumbing" autocomplete="organization" data-preview-name />
    </label>

    <div class="field">
      <span class="label">Logo <small class="muted">(optional — JPG, PNG or WebP)</small></span>
      <div class="logo-picker">
        <img class="logo-thumb" src="${logoUrl || ''}" alt="" ${logoUrl ? '' : html`hidden`} data-logo-thumb />
        <label class="btn btn-ghost file-btn"
          >${logoUrl ? 'Change logo' : 'Upload logo'}
          <input type="file" name="logo" accept="image/jpeg,image/png,image/webp" data-logo-input />
        </label>
        ${logoUrl ? html`<label class="check"><input type="checkbox" name="remove_logo" value="1" data-remove-logo /> Remove logo</label>` : ''}
      </div>
    </div>

    <fieldset class="field">
      <legend class="label">Brand colour</legend>
      <div class="swatches">
        ${SWATCHES.map(
          (c) => html`<label class="swatch" style="--c:${c}" title="${c}"
            ><input type="radio" name="brand_colour" value="${c}" ${c === colour ? 'checked' : ''} data-colour /><span></span
          ></label>`,
        )}
        <label class="swatch swatch-custom" title="Pick any colour"
          ><input type="radio" name="brand_colour" value="custom" ${custom ? 'checked' : ''} data-colour-custom-radio /><span
            ><input type="color" name="brand_colour_custom" value="${custom ? colour : '#0f766e'}" aria-label="Custom colour" data-colour-custom
          /></span>
        </label>
      </div>
    </fieldset>

    <label
      >Google review link
      <input
        name="google_review_url"
        value="${values.google_review_url || ''}"
        required
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="https://g.page/r/..."
        data-google-url
      />
      <small class="muted">Paste the Google review link for your business.</small>
    </label>
    <a class="small" href="#" target="_blank" rel="noopener noreferrer" data-test-link hidden>Test this link ↗</a>

    <details class="help">
      <summary>Where do I find my Google review link?</summary>
      <ol>
        <li>Search for your business name on Google (logged in to the Google account that manages it), or open the <strong>Google Business Profile</strong> app.</li>
        <li>Tap <strong>Ask for reviews</strong> (sometimes called <strong>Get more reviews</strong> or <strong>Share review form</strong>).</li>
        <li>Tap <strong>Copy link</strong>. It usually looks like <code>g.page/r/…/review</code>.</li>
        <li>Paste it in the box above.</li>
      </ol>
      <p class="muted small">
        Can't see that option? Find your business in Google's
        <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer">Place ID Finder</a>
        and paste the Place ID (it starts with <code>ChIJ</code>) — we'll build the link for you.
      </p>
    </details>

    <div class="field">
      <span class="label">Preview — what your customer sees</span>
      <div class="preview" style="--brand:${colour}" data-preview>
        <div class="preview-screen">
          <img class="preview-logo" src="${logoUrl || ''}" alt="" ${logoUrl ? '' : html`hidden`} data-preview-logo />
          <p class="preview-thanks">Thanks for choosing <strong data-preview-name-out>${values.name || 'your business'}</strong></p>
          <p class="preview-lead">We'd love to hear about your experience.</p>
          <span class="preview-btn">Leave a Google Review</span>
          <p class="preview-small">You'll be taken to Google to write and submit your review.</p>
        </div>
      </div>
    </div>

    <button class="btn btn-block btn-large" type="submit">${submitLabel}</button>
  </form>`;
}

module.exports = { businessForm };
