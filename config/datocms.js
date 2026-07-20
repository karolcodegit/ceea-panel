const { log } = require('console');
const { GraphQLClient, gql } = require('graphql-request');

if (!process.env.DATOCMS_API_TOKEN && process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
}


const DATOCMS_API_TOKEN = process.env.DATOCMS_API_TOKEN;
const DATOCMS_ENVIRONMENT = process.env.DATOCMS_ENVIRONMENT || 'main';

if (!DATOCMS_API_TOKEN) {
  console.warn('⚠️  DATOCMS_API_TOKEN nie ustawiony. Strony pomocy/polityki/regulaminu będą statyczne.');
}

const client = new GraphQLClient(
  `https://graphql.datocms.com/environments/${DATOCMS_ENVIRONMENT}`,
  {
    headers: {
      authorization: `Bearer ${DATOCMS_API_TOKEN}`,
    },
  }
);

// Zapytanie: dane firmy
const GET_COMPANY = gql`
  query GetCompany {
    company {
      nameCompany
      nip
      krs
      regon
      mail
      city
      numberHome
      bankAccount
      bankAccountName
      description
      openingHours
    }
  }
`;

// Zapytanie: strona pomocy z kategoriami i pytaniami
const GET_HELP_PAGE = gql`
  query GetHelpPage {
    allHelpcategorypanels(orderBy: _createdAt_ASC) {
      id
      title
      description
      icon
    }
    allHelpquestionpanels(orderBy: _createdAt_ASC) {
      id
      question
      answer
      callout {
        __typename
        ... on CalloutRecord { id kind content }
      }
      category { id }
    }
  }
`;

// === FUNKCJE ===

async function fetchCompany() {
  if (!DATOCMS_API_TOKEN) return null;
  try {
    const data = await client.request(GET_COMPANY);
    return data.company || null;
  } catch (err) {
    console.error('❌ DatoCMS fetchCompany error:', err.message);
    return null;
  }
}

async function fetchHelpPage() {
  if (!DATOCMS_API_TOKEN) return null;
  try {
    const data = await client.request(GET_HELP_PAGE);
    console.log(data);
    return {
      page: null,
      categories: data.allHelpcategorypanels,
      questions: data.allHelpquestionpanels,
    };
  } catch (err) {
    console.error('❌ DatoCMS fetchHelpPage error:', err.message);
    return null;
  }
}

// === EKSPORT ===
module.exports = {
  fetchCompany,
  fetchHelpPage,
};