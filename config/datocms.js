const { GraphQLClient, gql } = require('graphql-request');
const { slugify } = require("../utils/slugify");
const {getYearFromDate} = require("../utils/getYearFromDate")

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
      street
      zipCode
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

const GET_ACTIVE_COURSE = gql`
  query GetActiveCourse {
    allCourses(filter: { available: { eq: true } }, orderBy: date_DESC, first: 1) {
      id
      nameCourse
      date
    }
  }
`;



const GET_ALL_COURSES = gql`
  query GetAllCourses {
    allCourses(first: 100, orderBy: _createdAt_DESC) {
      id
      nameCourse
      description
      date
      available
      language
      image { url(imgixParams: { w: "640", h: "360", fit: crop, auto: format }) }
    }
  }
`;


const GET_COURSE = gql`
  query GetCourse($id: ItemId!) {
    course(filter: { id: { eq: $id } }) {
      id
      nameCourse
      description
      date
      available
      image { url(imgixParams: { w: "640", h: "360", fit: crop, auto: format }) }
    }
  }
`;



// === FUNKCJE ===



// === COMPANY ==  //

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


// === HELP == //

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


// === COURSE ACTIVE == //

async function fetchActiveCourse() {
  if (!DATOCMS_API_TOKEN) return null;
  try {
    const data = await client.request(GET_ACTIVE_COURSE);
    const c = data.allCourses?.[0];

    if (!c) return null;
    return {
      name: c.nameCourse,
      year: getYearFromDate(c.date),
      slug: slugify(c.nameCourse),
    };
  } catch (err) {
    console.error('❌ DatoCMS fetchActiveCourse error:', err.message);
    return null;
  }
}


// === ALL COURSE == //

async function fetchAllCourses() {
  if (!DATOCMS_API_TOKEN) return [];
  try {
    const data = await client.request(GET_ALL_COURSES);
    return data.allCourses || [];
  } catch (err) {
    console.error("❌ DatoCMS fetchAllCourses error:", err.message);
    return [];
  }
}

// === ID COURSE  // ==

async function fetchCourseById(id) {
  if (!DATOCMS_API_TOKEN) return null;
  try {
    const data = await client.request(GET_COURSE, { id });
    return data.course || null;
  } catch (err) {
    console.error("❌ DatoCMS fetchCourseById error:", err.message);
    return null;
  }
}

// === EKSPORT ===
module.exports = {
  fetchCompany,
  fetchHelpPage,
  fetchActiveCourse,
  fetchAllCourses,
  fetchCourseById
};