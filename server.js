const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Firebase Admin SDK
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore(); // Firestore database
const app = express();

// Configure CORS to allow requests from localhost and Expo
app.use(cors({
  origin: [
    'http://localhost:8080',
    'http://localhost:19006',
    'exp://localhost:19000',
    'exp://localhost:19006',
    'exp://10.131.56.29:19000',
    'exp://10.131.56.29:19006',
    'http://10.131.56.29:19006'
  ],
  credentials: true
}));

// Now add your other middlewares
app.use(express.json());

// **🔥 Middlewar e to Verify Firebase Authentication Token**
// Middleware to Verify Firebase Authentication Token
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  // Log the incoming request URL and method
  console.log(`Incoming request: ${req.method} ${req.url}`);

  // Log the received token (if any)
  if (!token) {
    console.warn('No token received');
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  } else {
    console.log('Received token:', token);
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log('Decoded token:', decodedToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying token:', error.message);
    return res.status(403).json({ error: 'Unauthorized - Invalid token' });
  }
};



// ✅ **API to Save User Profile**
app.post('/api/profile', authenticate, async (req, res) => {
  console.log('Request body:', req.body); // Log the body to check if 'bio' is there

  const { age, school, goToGym, gymName, bio } = req.body; // Destructure bio
  const userId = req.user.uid; // Get user ID from token

  try {
    await db.collection('users').doc(userId).set({
      age,
      school,
      goToGym,
      gymName,
      bio,  // Save bio field
      profilePicture: null, // Default profile picture
    }, { merge: true });

    res.json({ message: 'Profile saved successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Error saving profile', details: error.message });
  }
});



// ✅ **API to Fetch User Profile**
app.get('/api/profile', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    const doc = await db.collection('users').doc(userId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json(doc.data());
  } catch (error) {
    res.status(500).json({ error: 'Error fetching profile', details: error.message });
  }
});

// ✅ **API to Store Friends List**
app.post('/api/friends', authenticate, async (req, res) => {
  const userId = req.user.uid;
  const { friendId, friendEmail } = req.body;

  if (!friendId && !friendEmail) {
    return res.status(400).json({ error: 'Either Friend ID or Friend Email is required' });
  }

  try {
    // Get the user's own data
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();

    // Find the friend by ID or email
    let friendData;
    let friendUserId;

    if (friendId) {
      // If friendId is provided, use it directly
      const friendDoc = await db.collection('users').doc(friendId).get();
      if (!friendDoc.exists) {
        return res.status(404).json({ error: 'Friend not found' });
      }
      friendData = friendDoc.data();
      friendUserId = friendId;
    } else {
      // If friendEmail is provided, look up the user by email
      const usersSnapshot = await db.collection('users').where('email', '==', friendEmail).get();
      if (usersSnapshot.empty) {
        return res.status(404).json({ error: 'No user found with that email' });
      }
      // Use the first matching user
      const friendDoc = usersSnapshot.docs[0];
      friendData = friendDoc.data();
      friendUserId = friendDoc.id;
    }

    // Prevent adding yourself as a friend
    if (friendUserId === userId) {
      return res.status(400).json({ error: 'You cannot add yourself as a friend' });
    }

    // Check if already friends
    const existingFriendDoc = await db.collection('users').doc(userId).collection('friends').doc(friendUserId).get();
    if (existingFriendDoc.exists) {
      return res.status(400).json({ error: 'Already friends with this user' });
    }

    // Add friend to user's friends collection with name
    await db.collection('users').doc(userId).collection('friends').doc(friendUserId).set({
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      name: friendData.username || 'Unknown User'
    });

    // Add user to friend's friends collection with name
    await db.collection('users').doc(friendUserId).collection('friends').doc(userId).set({
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      name: userData.username || 'Unknown User'
    });

    res.json({ message: 'Friend added successfully!' });
  } catch (error) {
    console.error('Error adding friend:', error);
    res.status(500).json({ error: 'Error adding friend', details: error.message });
  }
});

// ✅ **API to Fetch Friends List**
app.get('/api/friends', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    const snapshot = await db.collection('users').doc(userId).collection('friends').get();
    const friends = snapshot.docs.map(doc => doc.data());

    res.json(friends);  // This will return the list of friends specific to the authenticated user
  } catch (error) {
    res.status(500).json({ error: 'Error fetching friends', details: error.message });
  }
});


// ✅ **API to Save Workouts**
app.post('/api/workouts', authenticate, async (req, res) => {
  const userId = req.user.uid;
  const { name, date, exercises } = req.body;

  if (!name || !date || !exercises) {
    return res.status(400).json({ error: 'Name, date, and exercises are required' });
  }

  try {
    const workoutRef = db.collection('users').doc(userId).collection('workouts').doc();
    await workoutRef.set({ name, date, exercises });

    res.json({ message: 'Workout saved successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Error saving workout', details: error.message });
  }
});

// ✅ **API to Fetch Workouts**
app.get('/api/workouts', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    const snapshot = await db.collection('users').doc(userId).collection('workouts').get();
    const workouts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.json(workouts);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching workouts', details: error.message });
  }
});

// ✅ **API to Store Notifications**
app.post('/api/notifications', authenticate, async (req, res) => {
  const userId = req.user.uid;
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    
    const notificationRef = db.collection('users').doc(userId).collection('notifications').doc();
    await notificationRef.set({ message, timestamp: admin.firestore.FieldValue.serverTimestamp() });

    res.json({ message: 'Notification saved successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Error saving notification', details: error.message });
  }
});


const fetch = require('node-fetch'); // If you're using fetch
app.get('/api/recommended', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    // Get the logged-in user's profile
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    const userProfile = userDoc.data();
    console.log("User Profile:", userProfile);

    // Get the user's friends list
    const friendsSnapshot = await db.collection('users').doc(userId).collection('friends').get();
    const friendIds = friendsSnapshot.docs.map(doc => doc.id);
    console.log("User's friends:", friendIds);

    // Fetch all other users
    const usersSnapshot = await db.collection('users').get();
    let otherUsers = [];
    usersSnapshot.forEach(doc => {
      // Skip the current user but include users who were previously friends
      // This ensures deleted friends show up in recommendations again
      if (doc.id !== userId) {
        // Add the userId to each user object for reference
        const userData = doc.data();
        userData.userId = doc.id;
        
        // Check if this user is a current friend
        const isFriend = friendIds.includes(doc.id);
        
        // Only add non-friends to the recommendations
        if (!isFriend) {
          otherUsers.push(userData);
        }
      }
    });

    console.log("Fetched users (excluding current friends):", otherUsers);

    if (otherUsers.length === 0) {
      return res.status(404).json({ error: 'No other users found or all users are already your friends' });
    }

    // Make Gemini API call to get more recommendations
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `As a fitness AI, analyze this user profile and suggest compatible workout partners.
                Current user: ${JSON.stringify(userProfile)}
                Available users: ${JSON.stringify(otherUsers)}
                
                IMPORTANT: Only include users that have the EXACT SAME gym name as the current user.
                
                Return a JSON array of up to 5 most compatible users.
                Do not create fictional users or placeholders if fewer than 5 users match the criteria.
                
                Base compatibility on:
                1. Must have the same gym name (case-insensitive match) - this is the highest priority
                2. Similar age (if available)
                3. Similar interests from bio (if available)
                
                Include ONLY these fields in each user object:
                {
                  "email": "user's email",
                  "username": "user's name",
                  "age": "user's age",
                  "gymName": "EXACT gym name from their profile",
                  "bio": "user's bio",
                  "reason": "A personalized 1-2 sentence explanation of why this person would be a good workout partner for the user"
                }
                
                Format your response as a raw JSON array with NO markdown formatting or extra text.
                If no users match the criteria, return an empty array [].`
              }
            ]
          }
        ]
      }),
    });

    const geminiData = await geminiResponse.json();
    console.log("Gemini Response:", geminiData);

    // Check if candidates exist in the Gemini response
    if (!geminiData || !geminiData.candidates || geminiData.candidates.length === 0) {
      return res.status(500).json({ error: 'Gemini API response does not contain candidates' });
    }

    // Extract and clean the Gemini candidates text
    const geminiCandidatesText = geminiData.candidates[0].content.parts[0].text;
    console.log("Raw Gemini response:", geminiCandidatesText);

    // Clean and parse the JSON response
    let cleanJsonString = geminiCandidatesText;
    
    // Remove any markdown code block markers
    cleanJsonString = cleanJsonString.replace(/```json\n?|```\n?/g, '');
    
    // Remove any trailing/leading whitespace
    cleanJsonString = cleanJsonString.trim();

    console.log("Cleaned JSON String:", cleanJsonString);

    let recommendedPeople = [];
    try {
      recommendedPeople = JSON.parse(cleanJsonString);
      if (!Array.isArray(recommendedPeople)) {
        throw new Error('Response is not an array');
      }
      console.log("Parsed recommended people:", recommendedPeople);
    } catch (error) {
      console.error("Error parsing Gemini response:", error);
      console.error("Failed JSON string:", cleanJsonString);
      return res.status(500).json({ 
        error: 'Error parsing Gemini response JSON', 
        details: error.message,
        rawResponse: geminiCandidatesText 
      });
    }

    console.log("Recommended people from Gemini:", recommendedPeople);
    console.log("Number of recommendations before filtering:", recommendedPeople.length);

    // If Gemini returns no recommendations, use the filtered users from Firestore
    if (!recommendedPeople || recommendedPeople.length === 0) {
      console.log("No recommendations from Gemini, using filtered users directly");
      recommendedPeople = otherUsers.map(user => ({
        email: user.email,
        username: user.username,
        age: user.age,
        gymName: user.gymName,
        bio: user.bio,
        reason: `This user might be a good match because they go to ${user.gymName}`,
        userId: user.userId
      }));
    }

    console.log("Final recommendations count:", recommendedPeople.length);
    console.log("Filtered recommendations:", recommendedPeople);

    // Filter users based on preferences with more flexible matching
    const exactMatches = recommendedPeople.filter(candidate => {
      // Log the filtering process for debugging
      console.log("Checking candidate:", candidate.username);
      console.log("Candidate gym:", candidate.gymName);
      console.log("User gym:", userProfile.gymName);

      // Basic validation
      if (!candidate || !candidate.gymName || !userProfile.gymName) {
        console.log("Skipping candidate due to missing data");
        return false;
      }

      // Case-insensitive gym name comparison with trimming
      const candidateGym = candidate.gymName.trim().toLowerCase();
      const userGym = userProfile.gymName.trim().toLowerCase();
      
      const isMatch = candidateGym === userGym;
      console.log("Gym match result:", isMatch);
      
      return isMatch;
    });

    console.log("Exact gym matches:", exactMatches.length);
    
    // Use exact matches if available, otherwise use all recommendations from Gemini
    // No need to force exactly 5 recommendations
    recommendedPeople = exactMatches.length > 0 ? exactMatches : recommendedPeople;
    
    console.log("Final recommendations count:", recommendedPeople.length);
    console.log("Filtered recommendations:", recommendedPeople);

    res.json(recommendedPeople);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ error: 'Error fetching recommendations', details: error.message });
  }
});



// ✅ **API to Fetch Notifications**
app.get('/api/notifications', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    const snapshot = await db.collection('users').doc(userId).collection('notifications').orderBy('timestamp', 'desc').get();
    const notifications = snapshot.docs.map(doc => doc.data());

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching notifications', details: error.message });
  }
});

// ✅ **Start the Server**
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
