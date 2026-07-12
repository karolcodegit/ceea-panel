function toggleFaq(button) {
    const answer = button.nextElementSibling;
    const icon = button.querySelector('.faq-chevron');
    const isOpen = answer.classList.contains('open');
    
    // Zamknij wszystkie w tej sekcji
    const section = button.closest('section');
    section.querySelectorAll('.faq-answer').forEach(el => {
      el.classList.remove('open');
      el.style.paddingBottom = '0';
    });
    section.querySelectorAll('.faq-chevron').forEach(el => el.classList.remove('rotate'));
    
    // Otwórz kliknięty (jeśli był zamknięty)
    if (!isOpen) {
      answer.classList.add('open');
      answer.style.paddingBottom = '1.25rem';
      icon.classList.add('rotate');
    }
  }
  
  function scrollToSection(id) {
    document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }