import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { DevAuthForm } from '@/components/DevAuthForm';

export default function SignInScreen() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Redirect href="/" />;
  return <DevAuthForm mode="sign-in" />;
}