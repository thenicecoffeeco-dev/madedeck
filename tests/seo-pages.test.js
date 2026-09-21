'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pages,policies,renderSeoPage,renderPolicyPage}=require('../src/seo-pages');
const fs=require('node:fs');
const path=require('node:path');

test('six distinct SEO pages render complete metadata and verified CTA paths',()=>{
  assert.equal(Object.keys(pages).length,6);
  for(const [slug,page] of Object.entries(pages)){
    const html=renderSeoPage(slug);
    assert.match(html,new RegExp(`<link rel="canonical" href="https://madedeck\\.com/${slug}">`));
    assert.match(html,/<meta name="description" content="[^\"]+">/);
    assert.match(html,/application\/ld\+json/);
    assert.match(html,/"@type":"Service"/);
    assert.match(html,/"@type":"FAQPage"/);
    assert.match(html,/class="seo-footer"/);
    assert.match(html,new RegExp(`href="${page.ctaHref.replace(/[?]/g,'\\?')}"`));
    assert.match(html,/viewport/);
    for(const linkedSlug of Object.keys(pages))assert.match(html,new RegExp(`href="/${linkedSlug}"`));
  }
});

test('public marketing facts match the checkout catalog',()=>{
  assert.equal(pages['custom-t-shirts'].starting,'Starting at $18');
  assert.equal(pages['custom-hoodies'].starting,'Starting at $26');
  assert.equal(pages['custom-hats'].starting,'Starting at $27');
  assert.match(pages['custom-stickers'].starting,/5×4/);
  assert.doesNotMatch(pages['custom-stickers'].starting,/5×7/);
});

test('physical checkout migration stores a verified Stripe shipping destination',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../db/migrations/015_checkout_shipping_addresses.sql'),'utf8');
  assert.match(sql,/stripe_checkout_session_id/);
  assert.match(sql,/line1 VARCHAR/);
  assert.match(sql,/postal_code VARCHAR/);
  assert.match(sql,/UNIQUE KEY uq_checkout_shipping_session/);
});

test('policy pages disclose shipping, payment, privacy, and security boundaries',()=>{
  for(const slug of ['terms','privacy','shipping-and-returns','security']){
    const html=renderPolicyPage(slug);
    assert.ok(html.includes(policies[slug].title));
    assert.match(html,/class="seo-footer"/);
  }
  assert.match(renderPolicyPage('privacy'),/shipping addresses/i);
  assert.match(renderPolicyPage('terms'),/Stripe/i);
  assert.match(renderPolicyPage('security'),/does not claim a certification/i);
});
