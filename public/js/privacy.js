// Sticky TOC highlighting
const sections = document.querySelectorAll('section[id]');
const tocLinks = document.querySelectorAll('.toc-link');

function updateActiveToc() {
  let current = '';
  
  sections.forEach(section => {
    const sectionTop = section.offsetTop;
    if (scrollY >= sectionTop - 200) {
      current = section.getAttribute('id');
    }
  });

  tocLinks.forEach(link => {
    link.classList.remove('text-red-600', 'border-red-600', 'border-l-2');
    link.classList.add('text-gray-500');
    
    if (link.getAttribute('href') === `#${current}`) {
      link.classList.add('text-red-600', 'border-red-600', 'border-l-2');
      link.classList.remove('text-gray-500');
    }
  });
}

window.addEventListener('scroll', updateActiveToc);
updateActiveToc();

// Smooth scroll for TOC links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});