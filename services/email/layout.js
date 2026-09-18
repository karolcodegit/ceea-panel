const year = new Date().getFullYear();

module.exports = function wrap(contentHtml, preheader = "") {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f7f7f7;color:#333;line-height:1.6}
    .container{max-width:600px;margin:20px auto;padding:20px;background:#fff;border:1px solid #e0e0e0}
    h1,h2,h3{font-size:20px;font-weight:700;color:#333;margin:30px 0 20px;text-align:left}
    p{font-size:16px;color:#555;margin:0 0 20px;text-align:left;word-break:break-word;overflow-wrap:anywhere}
    a{color:#007bff;text-decoration:none}
    .footer{font-size:12px;color:#555;text-align:center;margin-top:40px;margin-bottom:20px;border-top:1px solid #e0e0e0;padding-top:10px}
    .footer p{font-size:12px;text-align:center;margin:0 0 10px}
    img{max-width:100%;height:auto;display:block;margin:0 auto;border:0}
    @media only screen and (max-width:480px){
      .container{margin:0!important;padding:12px!important;border:none!important;max-width:100%!important}
      h1,h2,h3{font-size:18px!important;margin-top:20px!important;margin-bottom:12px!important}
      p{font-size:15px!important;margin:0 0 14px!important}
    }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${preheader}
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>
  <div class="container">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
      <tr><td align="center">
        <img src="cid:ceea-header" width="600" height="83" alt="CEEA Poznań" style="width:100%;max-width:600px;height:auto;margin-bottom:20px;object-fit:contain;">
      </td></tr>
    </table>
    ${contentHtml}
    <div class="footer">
      <p>Otrzymałeś tę wiadomość, ponieważ zgłosiłeś chęć udziału w kursie na stronie www.ceea.org.pl.</p>
      <p>Europejska Fundacja ds. Szkolenia w Anestezjologii<br>ul. Sokolnicka 56, 62-021 Paczkowo<br>NIP: 777-314-61-00 | REGON: 301341024 | KRS: 0000347155</p>
      <p>© ${year} CEEA Poznań. Wszelkie prawa zastrzeżone.</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
      <tr><td align="center">
        <img src="cid:ceea-footer" width="400" height="56" alt="Konto bankowe CEEA" style="width:100%;max-width:400px;height:auto;object-fit:contain;">
      </td></tr>
    </table>
  </div>
</body>
</html>`;
};