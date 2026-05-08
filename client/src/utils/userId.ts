export const getUserId = (): string => {
  let userId = localStorage.getItem('tichu_user_id');
  if (!userId) {
    userId = `user_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
    localStorage.setItem('tichu_user_id', userId);
  }
  return userId;
};
