'use strict';
const button=document.querySelector('.seo-menu');
const nav=document.querySelector('#seoNav');
if(button&&nav)button.addEventListener('click',()=>{const open=nav.classList.toggle('open');button.setAttribute('aria-expanded',String(open));});
document.querySelectorAll('img[loading="lazy"]').forEach(image=>image.addEventListener('error',()=>image.closest('figure')?.classList.add('image-failed')));
