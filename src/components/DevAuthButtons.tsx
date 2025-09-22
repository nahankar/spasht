"use client";

// Development-only auth buttons when Clerk is not configured
export function DevAuthButtons() {
  return (
    <div className="flex gap-2 items-center text-sm text-gray-600">
      <span>Dev Mode</span>
      <button 
        className="px-3 py-1 bg-blue-500 text-white rounded text-xs"
        onClick={() => alert('Clerk not configured - this is a dev placeholder')}
      >
        Sign In
      </button>
    </div>
  );
}

